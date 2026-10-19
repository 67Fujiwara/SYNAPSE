import type { NewShadowItem, ShadowAttempt, ShadowItem } from '../../shared/types';
import { addDays, MASTER_SCORE, nextInterval } from '../../shared/srs';

interface ItemRow {
  id: string;
  text: string;
  source: ShadowItem['source'];
  ja_text: string | null;
  due_at: string | null;
  interval_days: number;
  best_score: number;
  best_wpm: number;
  mastered_count: number;
  created_at: string;
  attempts: number;
}

function rowToItem(r: ItemRow): ShadowItem {
  return {
    id: r.id,
    text: r.text,
    source: r.source,
    jaText: r.ja_text,
    dueAt: r.due_at,
    intervalDays: r.interval_days,
    bestScore: r.best_score,
    bestWpm: r.best_wpm,
    masteredCount: r.mastered_count,
    attempts: r.attempts,
    createdAt: r.created_at,
  };
}

const SELECT = `SELECT i.*, (SELECT COUNT(*) FROM shadow_attempts a WHERE a.item_id = i.id) AS attempts FROM shadow_items i`;

/** All items, due ones first (never-attempted count as due), then by creation. */
export async function listItems(db: D1Database): Promise<ShadowItem[]> {
  const { results } = await db.prepare(`${SELECT} ORDER BY (i.due_at IS NULL) DESC, i.due_at ASC, i.created_at DESC`).all<ItemRow>();
  return results.map(rowToItem);
}

/** Insert items, skipping texts already in the deck (case/space-insensitive). Returns the inserted items. */
export async function addItems(db: D1Database, items: NewShadowItem[], ids: string[], now: string): Promise<ShadowItem[]> {
  const { results: existing } = await db.prepare('SELECT text FROM shadow_items').all<{ text: string }>();
  const have = new Set(existing.map((r) => norm(r.text)));
  const stmts: D1PreparedStatement[] = [];
  const inserted: ShadowItem[] = [];
  items.forEach((it, idx) => {
    const text = it.text.trim();
    if (!text || have.has(norm(text))) return;
    have.add(norm(text));
    const id = ids[idx];
    stmts.push(
      db
        .prepare('INSERT INTO shadow_items (id, text, source, ja_text, due_at, interval_days, best_score, best_wpm, mastered_count, created_at) VALUES (?,?,?,?,NULL,0,0,0,0,?)')
        .bind(id, text, it.source, it.jaText ?? null, now),
    );
    inserted.push({ id, text, source: it.source, jaText: it.jaText ?? null, dueAt: null, intervalDays: 0, bestScore: 0, bestWpm: 0, masteredCount: 0, attempts: 0, createdAt: now });
  });
  if (stmts.length) await db.batch(stmts);
  return inserted;
}

function norm(t: string): string {
  return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export async function deleteItem(db: D1Database, id: string) {
  await db.batch([db.prepare('DELETE FROM shadow_attempts WHERE item_id = ?').bind(id), db.prepare('DELETE FROM shadow_items WHERE id = ?').bind(id)]);
}

/** Record an attempt and reschedule the item. Returns the updated item. */
export async function recordAttempt(db: D1Database, a: ShadowAttempt): Promise<ShadowItem | null> {
  const row = await db.prepare(`${SELECT} WHERE i.id = ?`).bind(a.itemId).first<ItemRow>();
  if (!row) return null;
  const interval = nextInterval(row.interval_days, a.score);
  const mastered = a.mode === 'recall' ? (a.score >= MASTER_SCORE ? row.mastered_count + 1 : 0) : row.mastered_count;
  await db.batch([
    db
      .prepare('INSERT INTO shadow_attempts (id, item_id, at, score, wpm, speed, mode, duration_sec) VALUES (?,?,?,?,?,?,?,?)')
      .bind(a.id, a.itemId, a.at, a.score, a.wpm, a.speed, a.mode, a.durationSec),
    db
      .prepare('UPDATE shadow_items SET due_at = ?, interval_days = ?, best_score = MAX(best_score, ?), best_wpm = MAX(best_wpm, ?), mastered_count = ? WHERE id = ?')
      .bind(addDays(a.at, interval), interval, a.score, a.wpm, mastered, a.itemId),
  ]);
  const updated = await db.prepare(`${SELECT} WHERE i.id = ?`).bind(a.itemId).first<ItemRow>();
  return updated ? rowToItem(updated) : null;
}
