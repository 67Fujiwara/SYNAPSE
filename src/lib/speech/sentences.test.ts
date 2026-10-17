import { describe, expect, it } from 'vitest';
import { SentenceChunker } from './sentences';

describe('SentenceChunker', () => {
  it('emits sentences as soon as they complete', () => {
    const c = new SentenceChunker();
    expect(c.push('Oh nice')).toEqual([]);
    expect(c.push('. So the ')).toEqual(['Oh nice.']);
    expect(c.push("interlock tripped? What'd ")).toEqual(['So the interlock tripped?']);
    expect(c.push('you do')).toEqual([]);
    expect(c.flush()).toEqual(["What'd you do"]);
  });
  it('does not split on abbreviations like e.g.', () => {
    const c = new SentenceChunker();
    expect(c.push('Use a drive, e.g. a VFD, for that. Got it?')).toEqual(['Use a drive, e.g. a VFD, for that.']);
    expect(c.push(' ')).toEqual(['Got it?']);
  });
  it('treats a newline as a sentence end', () => {
    const c = new SentenceChunker();
    expect(c.push('First line\nSecond')).toEqual(['First line']);
    expect(c.flush()).toEqual(['Second']);
  });
});
