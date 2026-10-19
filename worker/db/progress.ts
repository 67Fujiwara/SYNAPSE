import type { DailyStat, Mode, ProgressResponse, Session, ShadowItem, WeekAgg } from '../../shared/types';
import { rowToSession } from './sessions';
import { shiftDate, streakDetail } from './stats';

interface DailyRow {
  date: string;
  speaking_sec: number;
  words: number;
  sessions: number;
  mission_done: number;
  bonus_xp: number;
}

const EMPTY_WEEK: WeekAgg = {
  sessions: 0,
  speakingSec: 0,
  words: 0,
  wpm: 0,
  errorRate: 0,
  fillerRate: 0,
  avgLatencySec: 0,
  jpHintPer100: 0,
  shadowAttempts: 0,
  shadowAvgScore: 0,
};

/** Monday of the week containing `ymd`. */
export function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return shiftDate(ymd, -((dow + 6) % 7));
}

export function aggregateWeek(sessions: Session[], shadow: { score: number }[]): WeekAgg {
  if (sessions.length === 0 && shadow.length === 0) return { ...EMPTY_WEEK };
  const words = sessions.reduce((a, s) => a + s.words, 0);
  const sec = sessions.reduce((a, s) => a + s.speakingSec, 0);
  const w = (f: (s: Session) => number) => (words ? sessions.reduce((a, s) => a + f(s) * s.words, 0) / words : 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    sessions: sessions.length,
    speakingSec: r(sec),
    words,
    wpm: sec > 0 ? r(words / (sec / 60)) : 0,
    errorRate: r(w((s) => s.errorRate)),
    fillerRate: r(w((s) => s.fillerRate)),
    avgLatencySec: sessions.length ? r(sessions.reduce((a, s) => a + s.avgLatencySec, 0) / sessions.length) : 0,
    jpHintPer100: words ? r((sessions.reduce((a, s) => a + s.jpHintCount, 0) / words) * 100) : 0,
    shadowAttempts: shadow.length,
    shadowAvgScore: shadow.length ? r(shadow.reduce((a, x) => a + x.score, 0) / shadow.length) : 0,
  };
}

export async function getProgress(db: D1Database, today: string): Promise<ProgressResponse> {
  const from = shiftDate(today, -364);
  const monthAgo = shiftDate(today, -29);
  const ws = weekStart(today);
  const prevWs = shiftDate(ws, -7);

  const [daily, active, totals, bonus, recentRows, modeRows, shadowAgg, mastered, weekRows, shadowWeek, challenge] = await Promise.all([
    db.prepare('SELECT * FROM daily_stats WHERE date >= ? AND date <= ? ORDER BY date').bind(from, today).all<DailyRow>(),
    db.prepare('SELECT date FROM daily_stats WHERE sessions > 0 AND date <= ? ORDER BY date DESC LIMIT 1000').bind(today).all<{ date: string }>(),
    db
      .prepare('SELECT COUNT(*) AS sessions, COALESCE(SUM(speaking_sec),0) AS speaking_sec, COALESCE(SUM(words),0) AS words, COALESCE(SUM(xp),0) AS xp FROM sessions')
      .first<{ sessions: number; speaking_sec: number; words: number; xp: number }>(),
    db.prepare('SELECT COALESCE(SUM(bonus_xp),0) AS bonus FROM daily_stats').first<{ bonus: number }>(),
    db.prepare('SELECT * FROM sessions ORDER BY ended_at DESC LIMIT 30').all<Parameters<typeof rowToSession>[0]>(),
    db
      .prepare('SELECT mode, COALESCE(SUM(speaking_sec),0) AS sec FROM sessions WHERE local_date >= ? GROUP BY mode')
      .bind(monthAgo)
      .all<{ mode: Mode; sec: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS attempts, COALESCE(AVG(score),0) AS avg_score, COALESCE(MAX(wpm),0) AS best_wpm, COALESCE(SUM(duration_sec),0) AS duration,
                COALESCE(SUM(CASE WHEN at >= ? THEN duration_sec ELSE 0 END),0) AS duration_30d
         FROM shadow_attempts`,
      )
      .bind(monthAgo + 'T00:00:00')
      .first<{ attempts: number; avg_score: number; best_wpm: number; duration: number; duration_30d: number }>(),
    db
      .prepare(
        `SELECT i.*, (SELECT COUNT(*) FROM shadow_attempts a WHERE a.item_id = i.id) AS attempts
         FROM shadow_items i WHERE i.mastered_count >= 3 ORDER BY i.best_score DESC LIMIT 50`,
      )
      .all<Record<string, unknown>>(),
    db.prepare('SELECT * FROM sessions WHERE local_date >= ? ORDER BY ended_at').bind(prevWs).all<Parameters<typeof rowToSession>[0] & { local_date: string }>(),
    db.prepare('SELECT score, at FROM shadow_attempts WHERE at >= ?').bind(prevWs + 'T00:00:00').all<{ score: number; at: string }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE mode = 'business' AND local_date >= ? AND words > 0")
      .bind(ws)
      .first<{ n: number }>(),
  ]);

  const byDate = new Map(daily.results.map((r) => [r.date, r]));
  const days: DailyStat[] = [];
  for (let i = 0; i < 365; i++) {
    const d = shiftDate(from, i);
    const r = byDate.get(d);
    days.push(
      r ? { date: d, speakingSec: r.speaking_sec, words: r.words, sessions: r.sessions, missionDone: r.mission_done } : { date: d, speakingSec: 0, words: 0, sessions: 0, missionDone: 0 },
    );
  }

  const modes: Record<Mode | 'shadow', number> = { daily: 0, business: 0, mywork: 0, free: 0, shadow: Math.round(shadowAgg?.duration_30d ?? 0) };
  for (const r of modeRows.results) if (r.mode in modes) modes[r.mode] = Math.round(r.sec);

  const weekSessions = weekRows.results.map((r) => ({ s: rowToSession(r), d: r.local_date }));
  const cur = weekSessions.filter((x) => x.d >= ws).map((x) => x.s);
  const prev = weekSessions.filter((x) => x.d < ws).map((x) => x.s);
  const shadowCur = shadowWeek.results.filter((a) => a.at.slice(0, 10) >= ws);
  const shadowPrev = shadowWeek.results.filter((a) => a.at.slice(0, 10) < ws);

  const sd = streakDetail(new Set(active.results.map((r) => r.date)), today);

  return {
    days,
    streak: sd.streak,
    freezeUsed: sd.freezeUsed,
    totals: {
      sessions: totals?.sessions ?? 0,
      speakingSec: totals?.speaking_sec ?? 0,
      words: totals?.words ?? 0,
      xp: (totals?.xp ?? 0) + (bonus?.bonus ?? 0),
    },
    modes,
    recent: recentRows.results.map(rowToSession),
    shadow: {
      attempts: shadowAgg?.attempts ?? 0,
      avgScore: Math.round(shadowAgg?.avg_score ?? 0),
      bestWpm: Math.round(shadowAgg?.best_wpm ?? 0),
      durationSec: Math.round(shadowAgg?.duration ?? 0),
      mastered: mastered.results.map(
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
    },
    week: { current: aggregateWeek(cur, shadowCur), previous: aggregateWeek(prev, shadowPrev), weekStart: ws },
    challenge: { done: challenge?.n ?? 0, target: 3, mode: 'business' },
  };
}

/** Mark today's mission done once; awards the bonus XP the first time only. Returns true when newly completed. */
export async function completeMission(db: D1Database, date: string, bonusXp: number): Promise<boolean> {
  const row = await db.prepare('SELECT mission_done FROM daily_stats WHERE date = ?').bind(date).first<{ mission_done: number }>();
  if (row?.mission_done) return false;
  await db
    .prepare(
      `INSERT INTO daily_stats (date, speaking_sec, words, sessions, mission_done, bonus_xp) VALUES (?, 0, 0, 0, 1, ?)
       ON CONFLICT(date) DO UPDATE SET mission_done = 1, bonus_xp = bonus_xp + excluded.bonus_xp`,
    )
    .bind(date, bonusXp)
    .run();
  return true;
}
