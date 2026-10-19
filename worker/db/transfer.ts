// Export / import of everything the app stores (Phase 3).
import type { ExportBundle, Review, ShadowAttempt, ShadowItem } from '../../shared/types';
import { getSession, rowToSession } from './sessions';
import { getSettings, putSettings } from './settings';
import { saveSession } from './sessions';
import { saveReview } from './reviews';

export async function exportAll(db: D1Database): Promise<ExportBundle> {
  const [sessionRows, reviewRows, itemRows, attemptRows, dailyRows, settings] = await Promise.all([
    db.prepare('SELECT * FROM sessions ORDER BY ended_at').all<Parameters<typeof rowToSession>[0]>(),
    db.prepare('SELECT * FROM reviews').all<Record<string, string>>(),
    db.prepare('SELECT i.*, (SELECT COUNT(*) FROM shadow_attempts a WHERE a.item_id = i.id) AS attempts FROM shadow_items i').all<Record<string, unknown>>(),
    db.prepare('SELECT * FROM shadow_attempts ORDER BY at').all<Record<string, unknown>>(),
    db.prepare('SELECT * FROM daily_stats ORDER BY date').all<Record<string, number | string>>(),
    getSettings(db),
  ]);
  const sessions = [];
  for (const r of sessionRows.results) {
    const p = await getSession(db, r.id);
    if (p) sessions.push(p);
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    sessions,
    reviews: reviewRows.results.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      corrections: JSON.parse(r.corrections),
      betterPhrases: JSON.parse(r.better_phrases),
      wins: JSON.parse(r.wins),
      termNotes: r.term_notes ? JSON.parse(r.term_notes) : [],
      createdAt: r.created_at,
    })),
    shadowItems: itemRows.results.map(
      (r) =>
        ({
          id: r.id,
          text: r.text,
          source: r.source,
          jaText: r.ja_text ?? null,
          dueAt: r.due_at ?? null,
          intervalDays: r.interval_days,
          bestScore: r.best_score,
          bestWpm: r.best_wpm,
          masteredCount: r.mastered_count,
          attempts: r.attempts,
          createdAt: r.created_at,
        }) as ShadowItem,
    ),
    shadowAttempts: attemptRows.results.map(
      (r) =>
        ({
          id: r.id,
          itemId: r.item_id,
          at: r.at,
          score: r.score,
          wpm: r.wpm,
          speed: r.speed,
          mode: r.mode ?? 'shadow',
          durationSec: r.duration_sec ?? 0,
        }) as ShadowAttempt,
    ),
    dailyStats: dailyRows.results.map((r) => ({
      date: String(r.date),
      speakingSec: Number(r.speaking_sec),
      words: Number(r.words),
      sessions: Number(r.sessions),
      missionDone: Number(r.mission_done),
      bonusXp: Number(r.bonus_xp ?? 0),
    })),
  };
}

/** Merge a bundle in: sessions/reviews/items/attempts are upserted by id; daily stats are rebuilt from sessions + bundle bonuses. */
export async function importAll(db: D1Database, b: ExportBundle): Promise<{ sessions: number; reviews: number; items: number; attempts: number }> {
  let sessions = 0;
  for (const p of b.sessions ?? []) {
    await saveSession(db, p, p.session.endedAt.slice(0, 10));
    sessions += 1;
  }
  let reviews = 0;
  for (const r of b.reviews ?? []) {
    await saveReview(db, r as Review);
    reviews += 1;
  }
  const stmts: D1PreparedStatement[] = [];
  for (const i of b.shadowItems ?? []) {
    stmts.push(
      db
        .prepare(
          'INSERT OR REPLACE INTO shadow_items (id, text, source, ja_text, due_at, interval_days, best_score, best_wpm, mastered_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(i.id, i.text, i.source, i.jaText ?? null, i.dueAt ?? null, i.intervalDays, i.bestScore, i.bestWpm, i.masteredCount, i.createdAt),
    );
  }
  for (const a of b.shadowAttempts ?? []) {
    stmts.push(
      db
        .prepare('INSERT OR REPLACE INTO shadow_attempts (id, item_id, at, score, wpm, speed, mode, duration_sec) VALUES (?,?,?,?,?,?,?,?)')
        .bind(a.id, a.itemId, a.at, a.score, a.wpm, a.speed, a.mode ?? 'shadow', a.durationSec ?? 0),
    );
  }
  for (const d of b.dailyStats ?? []) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO daily_stats (date, speaking_sec, words, sessions, mission_done, bonus_xp) VALUES (?, 0, 0, 0, ?, ?)
           ON CONFLICT(date) DO UPDATE SET mission_done = MAX(mission_done, excluded.mission_done), bonus_xp = MAX(bonus_xp, excluded.bonus_xp)`,
        )
        .bind(d.date, d.missionDone ?? 0, d.bonusXp ?? 0),
    );
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  if (b.settings) await putSettings(db, b.settings);
  return { sessions, reviews, items: (b.shadowItems ?? []).length, attempts: (b.shadowAttempts ?? []).length };
}
