import { describe, expect, it } from 'vitest';
import { expandContractions } from './contractions';
import { scoreAnswer } from './score';
import { countRepeats } from './repeat';

describe('expandContractions', () => {
  it('expands the common forms', () => {
    expect(expandContractions("I'm not a morning person. We can't do it, won't we?")).toBe('i am not a morning person. we can not do it, will not we?');
    expect(expandContractions("It's late and they've left. That's it.")).toBe('it is late and they have left. that is it.');
  });
  it('leaves possessives alone', () => {
    expect(expandContractions("the vendor's quote")).toBe("the vendor's quote");
  });
});

describe('contractions in scoring', () => {
  const item = { level: 1, cueKind: 'sentence' as const, answer: 'I am not a morning person.', alternatives: [], keywords: [] };
  it('a contracted answer is a full match', () => {
    const r = scoreAnswer(item, "I'm not a morning person");
    expect(r.score).toBe(100);
    expect(r.align.words.length).toBe(6); // one mark per displayed word of the reference
    expect(r.align.words.every((w) => w.mark === 'match')).toBe(true);
  });
  it('the other direction too', () => {
    const r = scoreAnswer({ ...item, answer: "I'm not a morning person." }, 'I am not a morning person');
    expect(r.score).toBe(100);
    expect(r.align.words.length).toBe(5);
  });
  it('repeats count across contraction forms', () => {
    expect(countRepeats("I'm not a morning person.", 'I am not a morning person').count).toBe(1);
  });
});
