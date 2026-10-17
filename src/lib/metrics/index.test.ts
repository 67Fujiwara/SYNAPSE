import { describe, expect, it } from 'vitest';
import { computeMetrics, countFillers, sentenceCount, uniqueWordCount, wordCount } from './index';

describe('metrics', () => {
  it('counts words ignoring punctuation', () => {
    expect(wordCount("I'm wiring the control panel, and it's... fine!")).toBe(8);
  });
  it('counts fillers', () => {
    expect(countFillers('Um, so uh the PLC, you know, tripped. Like, totally.')).toBe(4);
    expect(countFillers('I like this panel.')).toBe(0);
  });
  it('counts sentences', () => {
    expect(sentenceCount('Hi. How are you? Fine!')).toBe(3);
    expect(sentenceCount('no terminator')).toBe(1);
  });
  it('counts unique lemmas', () => {
    expect(uniqueWordCount(['panels panel', 'drives drive'])).toBe(2);
  });
  it('computes wpm from measured speaking time', () => {
    const m = computeMetrics([{ text: 'one two three four five six', startedAt: '', endedAt: '' }], 30);
    expect(m.words).toBe(6);
    expect(m.wpm).toBe(12);
  });
  it('falls back to turn durations when speaking time was not measured', () => {
    const m = computeMetrics(
      [{ text: 'one two three', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:10Z' }],
      null,
    );
    expect(m.speakingSec).toBe(10);
    expect(m.wpm).toBe(18);
  });
  it('ignores an implausibly short measured speaking time and caps wpm', () => {
    const m = computeMetrics(
      [{ text: 'one two three four five six seven eight nine ten', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:04Z' }],
      0.3,
    );
    expect(m.speakingSec).toBe(4);
    expect(m.wpm).toBeLessThanOrEqual(300);
  });
});
