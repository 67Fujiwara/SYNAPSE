import type { Review, ReviewSummary, Session } from '../../shared/types';

interface ReviewRow {
  id: string;
  session_id: string;
  corrections: string;
  better_phrases: string;
  wins: string;
  term_notes: string | null;
  created_at: string;
}

function rowToReview(r: ReviewRow): Review {
  return {
    id: r.id,
    sessionId: r.session_id,
    corrections: JSON.parse(r.corrections),
    betterPhrases: JSON.parse(r.better_phrases),
    wins: JSON.parse(r.wins),
    termNotes: r.term_notes ? JSON.parse(r.term_notes) : [],
    createdAt: r.created_at,
  };
}

/** Upsert the review for a session and fold its correction count into the session's error rate. */
export async function saveReview(db: D1Database, review: Review) {
  const session = await db.prepare('SELECT words FROM sessions WHERE id = ?').bind(review.sessionId).first<{ words: number }>();
  const words = session?.words ?? 0;
  const errorRate = words > 0 ? Math.round((review.corrections.length / words) * 100 * 100) / 100 : 0;
  await db.batch([
    db.prepare('DELETE FROM reviews WHERE session_id = ?').bind(review.sessionId),
    db
      .prepare('INSERT INTO reviews (id, session_id, corrections, better_phrases, wins, term_notes, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(
        review.id,
        review.sessionId,
        JSON.stringify(review.corrections),
        JSON.stringify(review.betterPhrases),
        JSON.stringify(review.wins),
        JSON.stringify(review.termNotes),
        review.createdAt,
      ),
    db.prepare('UPDATE sessions SET error_rate = ? WHERE id = ?').bind(errorRate, review.sessionId),
  ]);
}

export async function getReview(db: D1Database, sessionId: string): Promise<Review | null> {
  const row = await db.prepare('SELECT * FROM reviews WHERE session_id = ?').bind(sessionId).first<ReviewRow>();
  return row ? rowToReview(row) : null;
}

export async function listReviews(db: D1Database, limit = 20): Promise<ReviewSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, s.mode AS s_mode, s.ended_at AS s_ended_at, s.words AS s_words, s.speaking_sec AS s_speaking_sec
       FROM reviews r JOIN sessions s ON s.id = r.session_id
       ORDER BY s.ended_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<ReviewRow & { s_mode: string; s_ended_at: string; s_words: number; s_speaking_sec: number }>();
  return results.map((r) => ({
    review: rowToReview(r),
    session: { id: r.session_id, mode: r.s_mode as Session['mode'], endedAt: r.s_ended_at, words: r.s_words, speakingSec: r.s_speaking_sec },
  }));
}
