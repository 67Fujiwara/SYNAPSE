import { describe, expect, it } from 'vitest';
import { estimateLevel, skillScores, xpLevel } from './charts';

describe('estimateLevel', () => {
  it('starts at A2 and names what is missing for B1', () => {
    const r = estimateLevel({ wpm: 60, errorRate: 12, avgSentLen: 5, totalMinutes: 10 });
    expect(r.level).toBe('A2');
    expect(r.next).toBe('B1');
    expect(r.unmet.map((u) => u.label)).toEqual(['WPM', 'errors / 100 words', 'total minutes']);
  });
  it('reaches B2 when all B1 and B2 criteria hold', () => {
    const r = estimateLevel({ wpm: 115, errorRate: 4, avgSentLen: 9, totalMinutes: 400 });
    expect(r.level).toBe('B2');
    expect(r.next).toBe('C1');
  });
  it('does not skip a level', () => {
    // C1-grade wpm but too few minutes for B1 -> still A2
    expect(estimateLevel({ wpm: 150, errorRate: 1, avgSentLen: 12, totalMinutes: 5 }).level).toBe('A2');
  });
});

describe('skillScores', () => {
  it('maps metrics to 0-100', () => {
    const s = skillScores([{ wpm: 150, fillerRate: 0, errorRate: 0, uniqueWords: 120, jpHintCount: 0, words: 100 }], 80);
    expect(s).toEqual({ fluency: 100, accuracy: 100, vocabulary: 100, pronunciation: 80, independence: 100 });
  });
  it('is zero without sessions', () => {
    expect(skillScores([], 0).fluency).toBe(0);
  });
});

describe('xpLevel', () => {
  it('uses 100·n² thresholds', () => {
    expect(xpLevel(0)).toEqual({ level: 0, into: 0, need: 100 });
    expect(xpLevel(450)).toEqual({ level: 2, into: 50, need: 500 });
  });
});
