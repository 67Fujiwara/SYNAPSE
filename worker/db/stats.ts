import type { DailyStat, StatsResponse } from '../../shared/types';
import { listSessions } from './sessions';

interface DailyRow {
  date: string;
  speaking_sec: number;
  words: number;
  sessions: number;
  mission_done: number;
}

function rowToDaily(r: DailyRow): DailyStat {
  return {
    date: r.date,
    speakingSec: r.speaking_sec,
    words: r.words,
    sessions: r.sessions,
    missionDone: r.mission_done,
  };
}

function emptyDay(date: string): DailyStat {
  return { date, speakingSec: 0, words: 0, sessions: 0, missionDone: 0 };
}

/** YYYY-MM-DD arithmetic without time zones (dates are already local strings). */
export function shiftDate(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Consecutive days with >= 1 session, ending today or yesterday.
 * One missed day per 7 is forgiven (the weekly "freeze"); `freezeUsed` says
 * whether the current streak needed it.
 */
export function computeStreak(activeDates: Set<string>, today: string): number {
  return streakDetail(activeDates, today).streak;
}

export function streakDetail(activeDates: Set<string>, today: string): { streak: number; freezeUsed: boolean } {
  let cursor = activeDates.has(today) ? today : shiftDate(today, -1);
  if (!activeDates.has(cursor)) {
    // Neither today nor yesterday: the day before yesterday can still count if a freeze covers yesterday.
    const dayBefore = shiftDate(cursor, -1);
    if (!activeDates.has(dayBefore)) return { streak: 0, freezeUsed: false };
  }
  let streak = 0;
  let freezeUsed = false;
  let lastFreezeAt = -Infinity; // index (days back) of the last forgiven day
  for (let back = 0; back < 1000; back++) {
    if (activeDates.has(cursor)) {
      streak += 1;
    } else if (back - lastFreezeAt >= 7) {
      lastFreezeAt = back; // forgive this one missed day
      freezeUsed = true;
    } else break;
    cursor = shiftDate(cursor, -1);
  }
  // A trailing forgiven day at the very end of the walk adds nothing; trim it.
  return { streak, freezeUsed };
}

export async function getStats(db: D1Database, today: string, days = 7): Promise<StatsResponse> {
  const from = shiftDate(today, -(days - 1));
  const [{ results: window }, { results: active }, totals, recent] = await Promise.all([
    db
      .prepare('SELECT * FROM daily_stats WHERE date >= ? AND date <= ? ORDER BY date')
      .bind(from, today)
      .all<DailyRow>(),
    db
      .prepare('SELECT date FROM daily_stats WHERE sessions > 0 AND date <= ? ORDER BY date DESC LIMIT 400')
      .bind(today)
      .all<{ date: string }>(),
    db
      .prepare('SELECT COUNT(*) AS sessions, COALESCE(SUM(speaking_sec),0) AS speaking_sec, COALESCE(SUM(words),0) AS words FROM sessions')
      .first<{ sessions: number; speaking_sec: number; words: number }>(),
    listSessions(db, 5),
  ]);

  const byDate = new Map(window.map((r) => [r.date, rowToDaily(r)]));
  const series: DailyStat[] = [];
  for (let i = 0; i < days; i++) {
    const d = shiftDate(from, i);
    series.push(byDate.get(d) ?? emptyDay(d));
  }

  return {
    today: byDate.get(today) ?? emptyDay(today),
    streak: streakDetail(new Set(active.map((r) => r.date)), today).streak,
    days: series,
    totals: {
      sessions: totals?.sessions ?? 0,
      speakingSec: totals?.speaking_sec ?? 0,
      words: totals?.words ?? 0,
    },
    recent,
  };
}
