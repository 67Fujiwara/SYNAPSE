import { describe, expect, it } from 'vitest';
import { align, jaroWinkler, nextInterval, normalize, timingBonus } from './index';

describe('normalize', () => {
  it('lowercases, strips punctuation, maps numbers and variants', () => {
    expect(normalize("OK, I'm gonna check 3 panels.")).toEqual(['okay', "i'm", 'going', 'to', 'check', 'three', 'panels']);
  });
});

describe('jaroWinkler', () => {
  it('is 1 for identical and high for near words', () => {
    expect(jaroWinkler('interlock', 'interlock')).toBe(1);
    expect(jaroWinkler('interlock', 'interlok')).toBeGreaterThan(0.85);
    expect(jaroWinkler('panel', 'cable')).toBeLessThan(0.85);
  });
});

describe('align', () => {
  it('scores a perfect repeat at 100', () => {
    const r = align('The interlock tripped during commissioning.', 'the interlock tripped during commissioning');
    expect(r.score).toBe(100);
    expect(r.words.every((w) => w.mark === 'match')).toBe(true);
  });
  it('marks missing and near words', () => {
    const r = align('Can you send me the drawing revision?', 'can you send the drawing revison');
    const marks = r.words.map((w) => w.mark);
    expect(marks).toEqual(['match', 'match', 'match', 'missing', 'match', 'match', 'near']);
    expect(r.score).toBe(Math.round(((5 + 0.5) / 7) * 100));
  });
  it('collects extra words', () => {
    const r = align('Got it.', 'yeah got it okay');
    expect(r.extras).toEqual(['yes', 'okay']);
    expect(r.score).toBe(100);
  });
});

describe('spaced repetition', () => {
  it('resets to 1 day under 70% and climbs the ladder otherwise', () => {
    expect(nextInterval(7, 60)).toBe(1);
    expect(nextInterval(0, 90)).toBe(1);
    expect(nextInterval(1, 90)).toBe(3);
    expect(nextInterval(3, 90)).toBe(7);
    expect(nextInterval(30, 90)).toBe(30);
  });
  it('gives a timing bonus within ±20%', () => {
    expect(timingBonus(2.1, 2.0)).toBe(5);
    expect(timingBonus(3.0, 2.0)).toBe(0);
  });
});
