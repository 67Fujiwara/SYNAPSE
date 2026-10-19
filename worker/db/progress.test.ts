import { describe, expect, it } from 'vitest';
import { aggregateWeek, weekStart } from './progress';
import type { Session } from '../../shared/types';

const S = (p: Partial<Session>): Session => ({
  id: 'x',
  mode: 'daily',
  startedAt: '',
  endedAt: '',
  speakingSec: 60,
  words: 100,
  wpm: 100,
  fillerRate: 2,
  errorRate: 4,
  uniqueWords: 50,
  avgSentLen: 8,
  avgLatencySec: 1.5,
  jpHintCount: 1,
  xp: 10,
  ...p,
});

describe('weekStart', () => {
  it('returns the Monday of the week', () => {
    expect(weekStart('2026-10-19')).toBe('2026-10-19'); // Monday
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // Sunday
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
  });
});

describe('aggregateWeek', () => {
  it('weights rates by words and computes wpm from totals', () => {
    const a = aggregateWeek([S({ words: 100, speakingSec: 60, errorRate: 4 }), S({ words: 300, speakingSec: 120, errorRate: 0 })], [{ score: 80 }, { score: 60 }]);
    expect(a.sessions).toBe(2);
    expect(a.words).toBe(400);
    expect(a.wpm).toBeCloseTo(133.33, 2);
    expect(a.errorRate).toBe(1); // (4*100 + 0*300)/400
    expect(a.shadowAvgScore).toBe(70);
  });
  it('is empty with no data', () => {
    expect(aggregateWeek([], []).sessions).toBe(0);
  });
});
