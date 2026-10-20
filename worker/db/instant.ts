// Phase 4: instant composition (瞬間英作文) items and attempts.
import type { InstantAttempt, InstantItem, InstantStats, NewInstantItem } from '../../shared/types';
import { addDays, nextInterval } from '../../shared/srs';
import { INSTANT_MASTER_COUNT, LEVELS, levelSpec, nextMastered, type InstantLevel } from '../../shared/instant';

interface ItemRow {
  id: string;
  level: number;
  cue_kind: InstantItem['cueKind'];
  cue: string;
  transform: string | null;
  answer: string;
  alternatives: string;
  keywords: string;
  hint: string | null;
  topic: string | null;
  source: InstantItem['source'];
  due_at: string | null;
  interval_days: number;
  best_score: number;
  best_latency: number | null;
  mastered_count: number;
  created_at: string;
  attempts: number;
}

function parseList(s: string | null | undefined): string[] {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rowToInstantItem(r: ItemRow): InstantItem {
  return {
    id: r.id,
    level: r.level as InstantLevel,
    cueKind: r.cue_kind,
    cue: r.cue,
    transform: r.transform,
    answer: r.answer,
    alternatives: parseList(r.alternatives),
    keywords: parseList(r.keywords),
    hint: r.hint,
    topic: r.topic,
    source: r.source,
    dueAt: r.due_at,
    intervalDays: r.interval_days,
    bestScore: r.best_score,
    bestLatency: r.best_latency,
    masteredCount: r.mastered_count,
    attempts: r.attempts ?? 0,
    createdAt: r.created_at,
  };
}

const SELECT = `SELECT i.*, (SELECT COUNT(*) FROM instant_attempts a WHERE a.item_id = i.id) AS attempts FROM instant_items i`;

/** Items (optionally one level), due first, then newest. */
export async function listInstantItems(db: D1Database, level?: number): Promise<InstantItem[]> {
  const where = level ? ' WHERE i.level = ?' : '';
  const stmt = db.prepare(`${SELECT}${where} ORDER BY (i.due_at IS NULL) DESC, i.due_at ASC, i.created_at DESC`);
  const { results } = await (level ? stmt.bind(level) : stmt).all<ItemRow>();
  return results.map(rowToInstantItem);
}

export function norm(t: string): string {
  return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Insert items, skipping answers already present at the same level. Returns the inserted items. */
export async function addInstantItems(db: D1Database, items: NewInstantItem[], ids: string[], now: string): Promise<InstantItem[]> {
  const { results: existing } = await db.prepare('SELECT level, answer FROM instant_items').all<{ level: number; answer: string }>();
  const have = new Set(existing.map((r) => `${r.level}|${norm(r.answer)}`));
  const stmts: D1PreparedStatement[] = [];
  const inserted: InstantItem[] = [];
  items.forEach((it, idx) => {
    const answer = it.answer.trim();
    const cue = it.cue.trim();
    if (!answer || !cue) return;
    const key = `${it.level}|${norm(answer)}`;
    if (have.has(key)) return;
    have.add(key);
    const id = ids[idx];
    const alternatives = (it.alternatives ?? []).map((a) => a.trim()).filter((a) => a && norm(a) !== norm(answer)).slice(0, 4);
    const keywords = (it.keywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 5);
    stmts.push(
      db
        .prepare(
          `INSERT INTO instant_items (id, level, cue_kind, cue, transform, answer, alternatives, keywords, hint, topic, source, due_at, interval_days, best_score, best_latency, mastered_count, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,0,0,NULL,0,?)`,
        )
        .bind(id, it.level, it.cueKind, cue, it.transform ?? null, answer, JSON.stringify(alternatives), JSON.stringify(keywords), it.hint ?? null, it.topic ?? null, it.source, now),
    );
    inserted.push({
      id,
      level: it.level,
      cueKind: it.cueKind,
      cue,
      transform: it.transform ?? null,
      answer,
      alternatives,
      keywords,
      hint: it.hint ?? null,
      topic: it.topic ?? null,
      source: it.source,
      dueAt: null,
      intervalDays: 0,
      bestScore: 0,
      bestLatency: null,
      masteredCount: 0,
      attempts: 0,
      createdAt: now,
    });
  });
  // D1 batches are limited; 50 statements per batch is comfortably inside.
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return inserted;
}

export async function deleteInstantItem(db: D1Database, id: string) {
  await db.batch([db.prepare('DELETE FROM instant_attempts WHERE item_id = ?').bind(id), db.prepare('DELETE FROM instant_items WHERE id = ?').bind(id)]);
}

/** Record an attempt, reschedule the item (SRS) and update mastery. Returns the updated item. */
export async function recordInstantAttempt(db: D1Database, a: InstantAttempt): Promise<InstantItem | null> {
  const row = await db.prepare(`${SELECT} WHERE i.id = ?`).bind(a.itemId).first<ItemRow>();
  if (!row) return null;
  const spec = levelSpec(row.level);
  const interval = nextInterval(row.interval_days, a.passed ? Math.max(a.score, 70) : 0);
  const mastered = nextMastered(row.mastered_count, a.passed, a.latencySec, spec);
  const bestLatency = a.passed ? (row.best_latency === null ? a.latencySec : Math.min(row.best_latency, a.latencySec)) : row.best_latency;
  await db.batch([
    db
      .prepare('INSERT INTO instant_attempts (id, item_id, at, score, latency_sec, heard, passed, timed_out) VALUES (?,?,?,?,?,?,?,?)')
      .bind(a.id, a.itemId, a.at, a.score, a.latencySec, a.heard.slice(0, 500), a.passed ? 1 : 0, a.timedOut ? 1 : 0),
    db
      .prepare('UPDATE instant_items SET due_at = ?, interval_days = ?, best_score = MAX(best_score, ?), best_latency = ?, mastered_count = ? WHERE id = ?')
      .bind(addDays(a.at, interval), interval, a.score, bestLatency, mastered, a.itemId),
  ]);
  const updated = await db.prepare(`${SELECT} WHERE i.id = ?`).bind(a.itemId).first<ItemRow>();
  return updated ? rowToInstantItem(updated) : null;
}

/** Add bonus XP for the day (passes earn a little, like missions). */
export async function addBonusXp(db: D1Database, date: string, xp: number) {
  if (xp <= 0) return;
  await db
    .prepare(
      `INSERT INTO daily_stats (date, speaking_sec, words, sessions, mission_done, bonus_xp) VALUES (?, 0, 0, 0, 0, ?)
       ON CONFLICT(date) DO UPDATE SET bonus_xp = bonus_xp + excluded.bonus_xp`,
    )
    .bind(date, xp)
    .run();
}

export async function instantStats(db: D1Database, nowIso: string): Promise<InstantStats> {
  const [agg, byLevel] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS attempts, AVG(passed) * 100 AS pass_rate,
                (SELECT AVG(latency_sec) FROM instant_attempts WHERE passed = 1 AND timed_out = 0) AS avg_latency
         FROM instant_attempts`,
      )
      .first<{ attempts: number; pass_rate: number | null; avg_latency: number | null }>(),
    db
      .prepare(
        `SELECT level, COUNT(*) AS total,
                SUM(CASE WHEN due_at IS NULL OR due_at <= ? THEN 1 ELSE 0 END) AS due,
                SUM(CASE WHEN mastered_count >= ? THEN 1 ELSE 0 END) AS mastered
         FROM instant_items GROUP BY level`,
      )
      .bind(nowIso, INSTANT_MASTER_COUNT)
      .all<{ level: number; total: number; due: number; mastered: number }>(),
  ]);
  const map = new Map(byLevel.results.map((r) => [r.level, r]));
  return {
    attempts: agg?.attempts ?? 0,
    passRate: Math.round(agg?.pass_rate ?? 0),
    avgLatencySec: Math.round((agg?.avg_latency ?? 0) * 10) / 10,
    mastered: byLevel.results.reduce((s, r) => s + (r.mastered ?? 0), 0),
    byLevel: LEVELS.map((l) => {
      const r = map.get(l.level);
      return { level: l.level, total: r?.total ?? 0, due: r?.due ?? 0, mastered: r?.mastered ?? 0 };
    }),
  };
}

/** Material for the generator: the learner's own corrections, latest My Work scenario, and what they already have. */
export async function instantMaterials(db: D1Database, level: number) {
  const [reviews, scenario, existing] = await Promise.all([
    db.prepare('SELECT corrections, better_phrases FROM reviews ORDER BY created_at DESC LIMIT 6').all<{ corrections: string; better_phrases: string }>(),
    db.prepare("SELECT scenario FROM sessions WHERE mode = 'mywork' AND scenario IS NOT NULL AND scenario != '' ORDER BY ended_at DESC LIMIT 1").first<{ scenario: string }>(),
    db.prepare('SELECT answer FROM instant_items WHERE level = ? ORDER BY created_at DESC LIMIT 40').bind(level).all<{ answer: string }>(),
  ]);
  const fixes: string[] = [];
  const phrases: string[] = [];
  for (const r of reviews.results) {
    try {
      for (const c of JSON.parse(r.corrections) as { fixed: string }[]) if (c.fixed) fixes.push(c.fixed);
      for (const p of JSON.parse(r.better_phrases) as string[]) if (p) phrases.push(p);
    } catch {
      /* skip bad row */
    }
  }
  return {
    fixes: fixes.slice(0, 12),
    phrases: phrases.slice(0, 8),
    scenario: scenario?.scenario?.slice(0, 1200) ?? '',
    existing: existing.results.map((r) => r.answer),
  };
}

export async function exportInstant(db: D1Database): Promise<{ items: InstantItem[]; attempts: InstantAttempt[] }> {
  const [items, attempts] = await Promise.all([
    db.prepare(SELECT).all<ItemRow>(),
    db.prepare('SELECT * FROM instant_attempts ORDER BY at').all<{ id: string; item_id: string; at: string; score: number; latency_sec: number; heard: string; passed: number; timed_out: number }>(),
  ]);
  return {
    items: items.results.map(rowToInstantItem),
    attempts: attempts.results.map((a) => ({ id: a.id, itemId: a.item_id, at: a.at, score: a.score, latencySec: a.latency_sec, heard: a.heard, passed: Boolean(a.passed), timedOut: Boolean(a.timed_out) })),
  };
}

export function importInstantStatements(db: D1Database, items: InstantItem[], attempts: InstantAttempt[]): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  for (const i of items) {
    stmts.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO instant_items (id, level, cue_kind, cue, transform, answer, alternatives, keywords, hint, topic, source, due_at, interval_days, best_score, best_latency, mastered_count, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          i.id, i.level, i.cueKind, i.cue, i.transform ?? null, i.answer, JSON.stringify(i.alternatives ?? []), JSON.stringify(i.keywords ?? []), i.hint ?? null, i.topic ?? null,
          i.source, i.dueAt ?? null, i.intervalDays ?? 0, i.bestScore ?? 0, i.bestLatency ?? null, i.masteredCount ?? 0, i.createdAt,
        ),
    );
  }
  for (const a of attempts) {
    stmts.push(
      db
        .prepare('INSERT OR REPLACE INTO instant_attempts (id, item_id, at, score, latency_sec, heard, passed, timed_out) VALUES (?,?,?,?,?,?,?,?)')
        .bind(a.id, a.itemId, a.at, a.score, a.latencySec ?? 0, a.heard ?? '', a.passed ? 1 : 0, a.timedOut ? 1 : 0),
    );
  }
  return stmts;
}
