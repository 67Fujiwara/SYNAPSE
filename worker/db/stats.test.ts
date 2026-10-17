import { describe, expect, it } from 'vitest';
import { computeStreak, shiftDate } from './stats';

describe('shiftDate', () => {
  it('crosses month and year boundaries', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDate('2026-10-17', 6)).toBe('2026-10-23');
  });
});

describe('computeStreak', () => {
  it('counts consecutive active days ending today', () => {
    const active = new Set(['2026-10-15', '2026-10-16', '2026-10-17']);
    expect(computeStreak(active, '2026-10-17')).toBe(3);
  });
  it('keeps the streak alive when today has no session yet', () => {
    const active = new Set(['2026-10-15', '2026-10-16']);
    expect(computeStreak(active, '2026-10-17')).toBe(2);
  });
  it('breaks on a gap', () => {
    const active = new Set(['2026-10-13', '2026-10-14', '2026-10-16']);
    expect(computeStreak(active, '2026-10-17')).toBe(1);
    expect(computeStreak(active, '2026-10-18')).toBe(0);
  });
});
