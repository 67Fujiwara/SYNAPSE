import { describe, expect, it } from 'vitest';
import { frameRms, syllables, voicedSegments, wordAt, wordStarts } from './wordtiming';

describe('syllables', () => {
  it('counts vowel groups with the silent-e rule', () => {
    expect(syllables('not')).toBe(1);
    expect(syllables('survive')).toBe(2);
    expect(syllables('Monday.')).toBe(2);
    expect(syllables('table')).toBe(2);
    expect(syllables('trying')).toBe(2);
    expect(syllables('a')).toBe(1);
    expect(syllables('happy')).toBe(2);
    expect(syllables('yes')).toBe(1);
    expect(syllables('key')).toBe(1);
    expect(syllables('yesterday')).toBe(3);
  });
});

describe('voicedSegments', () => {
  it('finds speech after leading silence and splits at a pause', () => {
    // 10 ms frames: 0.3 s silence, 0.5 s voice, 0.25 s pause, 0.6 s voice, tail silence.
    const rms = new Float32Array(200).fill(0.001);
    for (let f = 30; f < 80; f++) rms[f] = 0.3;
    for (let f = 105; f < 165; f++) rms[f] = 0.25;
    const segs = voicedSegments(rms);
    expect(segs.length).toBe(2);
    expect(segs[0].start).toBeCloseTo(0.3, 2);
    expect(segs[0].end).toBeCloseTo(0.8, 2);
    expect(segs[1].start).toBeCloseTo(1.05, 2);
  });
  it('bridges short consonant gaps', () => {
    const rms = new Float32Array(100).fill(0.3);
    for (let f = 40; f < 48; f++) rms[f] = 0; // 80 ms closure
    expect(voicedSegments(rms).length).toBe(1);
  });
});

describe('wordStarts', () => {
  it('skips the leading silence: the first word starts when the voice does', () => {
    const starts = wordStarts(['Not', 'bad.', 'Just', 'trying', 'to', 'survive', 'Monday.'], [{ start: 0.3, end: 0.8 }, { start: 1.05, end: 1.65 }], 2.0);
    expect(starts[0]).toBeCloseTo(0.3, 2);
    // Two phrases, two voiced stretches: "Just" opens the second one after the pause.
    expect(starts[2]).toBeCloseTo(1.05, 2);
    expect(starts.every((s, i) => i === 0 || s >= starts[i - 1])).toBe(true);
  });
  it('one voiced stretch: words follow syllable weight', () => {
    const starts = wordStarts(['a', 'very', 'complicated', 'thing'], [{ start: 0.2, end: 2.2 }], 2.4);
    expect(starts[0]).toBeCloseTo(0.2, 2);
    expect(starts[2] - starts[1]).toBeGreaterThan(starts[1] - starts[0]); // "very" takes longer than "a"
    expect(starts[3] - starts[2]).toBeGreaterThan(starts[2] - starts[1]); // "complicated" longer still
  });
  it('no voice detected: even spread over the clip', () => {
    expect(wordStarts(['a', 'b'], [], 1.0)).toEqual([0, 0.5]);
  });
});

describe('frameRms / wordAt', () => {
  it('computes frame energy and picks the current word', () => {
    const s = new Float32Array(1600).fill(0.5);
    const rms = frameRms(s, 16000);
    expect(rms.length).toBe(10);
    expect(rms[0]).toBeCloseTo(0.5, 3);
    expect(wordAt([0.3, 0.6, 0.9], 0.1)).toBe(-1);
    expect(wordAt([0.3, 0.6, 0.9], 0.7)).toBe(1);
  });
});
