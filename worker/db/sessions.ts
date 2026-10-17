import type { Session, SessionPayload, Turn } from '../../shared/types';

interface SessionRow {
  id: string;
  mode: string;
  scenario: string | null;
  started_at: string;
  ended_at: string;
  speaking_sec: number;
  words: number;
  wpm: number;
  filler_rate: number;
  error_rate: number;
  unique_words: number;
  avg_sent_len: number;
  avg_latency_sec: number;
  jp_hint_count: number;
  xp: number;
  local_date: string;
}

interface TurnRow {
  id: string;
  session_id: string;
  role: 'user' | 'ai';
  text: string;
  started_at: string;
  ended_at: string;
  seq: number;
}

export function rowToSession(r: SessionRow): Session {
  return {
    id: r.id,
    mode: r.mode as Session['mode'],
    scenario: r.scenario,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    speakingSec: r.speaking_sec,
    words: r.words,
    wpm: r.wpm,
    fillerRate: r.filler_rate,
    errorRate: r.error_rate,
    uniqueWords: r.unique_words,
    avgSentLen: r.avg_sent_len,
    avgLatencySec: r.avg_latency_sec,
    jpHintCount: r.jp_hint_count,
    xp: r.xp,
  };
}

function rowToTurn(r: TurnRow): Turn {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    text: r.text,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

/**
 * Upsert a finished session with its turns and roll it into daily_stats.
 * Idempotent: re-sending the same session id (offline retry) replaces the
 * session and its turns and does not double-count the daily totals.
 */
export async function saveSession(db: D1Database, payload: SessionPayload, localDate: string) {
  const s = payload.session;
  const prev = await db
    .prepare('SELECT speaking_sec, words, local_date FROM sessions WHERE id = ?')
    .bind(s.id)
    .first<{ speaking_sec: number; words: number; local_date: string }>();

  const stmts: D1PreparedStatement[] = [];

  if (prev) {
    // Undo the previous contribution to daily_stats before re-adding.
    stmts.push(
      db
        .prepare(
          `UPDATE daily_stats SET speaking_sec = MAX(0, speaking_sec - ?), words = MAX(0, words - ?),
             sessions = MAX(0, sessions - 1) WHERE date = ?`,
        )
        .bind(prev.speaking_sec, prev.words, prev.local_date),
    );
    stmts.push(db.prepare('DELETE FROM turns WHERE session_id = ?').bind(s.id));
  }

  stmts.push(
    db
      .prepare(
        `INSERT OR REPLACE INTO sessions
          (id, mode, scenario, started_at, ended_at, speaking_sec, words, wpm, filler_rate, error_rate,
           unique_words, avg_sent_len, avg_latency_sec, jp_hint_count, xp, local_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        s.id,
        s.mode,
        s.scenario ?? null,
        s.startedAt,
        s.endedAt,
        s.speakingSec,
        s.words,
        s.wpm,
        s.fillerRate,
        s.errorRate,
        s.uniqueWords,
        s.avgSentLen,
        s.avgLatencySec,
        s.jpHintCount,
        s.xp,
        localDate,
      ),
  );

  payload.turns.forEach((t, i) => {
    stmts.push(
      db
        .prepare(
          `INSERT INTO turns (id, session_id, role, text, started_at, ended_at, seq) VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(t.id, s.id, t.role, t.text, t.startedAt, t.endedAt, i),
    );
  });

  stmts.push(
    db
      .prepare(
        `INSERT INTO daily_stats (date, speaking_sec, words, sessions, mission_done)
         VALUES (?, ?, ?, 1, 0)
         ON CONFLICT(date) DO UPDATE SET
           speaking_sec = speaking_sec + excluded.speaking_sec,
           words = words + excluded.words,
           sessions = sessions + 1`,
      )
      .bind(localDate, s.speakingSec, s.words),
  );

  await db.batch(stmts);
}

export async function listSessions(db: D1Database, limit = 20): Promise<Session[]> {
  const { results } = await db
    .prepare('SELECT * FROM sessions ORDER BY ended_at DESC LIMIT ?')
    .bind(limit)
    .all<SessionRow>();
  return results.map(rowToSession);
}

export async function getSession(db: D1Database, id: string): Promise<SessionPayload | null> {
  const row = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<SessionRow>();
  if (!row) return null;
  const { results } = await db
    .prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY seq')
    .bind(id)
    .all<TurnRow>();
  return { session: rowToSession(row), turns: results.map(rowToTurn) };
}

export async function deleteAll(db: D1Database) {
  await db.batch([
    db.prepare('DELETE FROM turns'),
    db.prepare('DELETE FROM sessions'),
    db.prepare('DELETE FROM daily_stats'),
    db.prepare('DELETE FROM reviews'),
    db.prepare('DELETE FROM shadow_attempts'),
    db.prepare('DELETE FROM shadow_items'),
    db.prepare('DELETE FROM recordings'),
  ]);
}
