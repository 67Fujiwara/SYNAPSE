import { describe, expect, it } from 'vitest';
import { countRepeats } from './repeat';

const A = "I'm not a morning person.";

describe('countRepeats', () => {
  it('one clean repeat', () => {
    expect(countRepeats(A, "I'm not a morning person").count).toBe(1);
  });
  it('a wrong sentence counts zero', () => {
    expect(countRepeats(A, 'I like coffee in the morning').count).toBe(0);
  });
  it('three repeats in one chunk count three', () => {
    expect(countRepeats(A, "I'm not a morning person. I'm not a morning person. I'm not a morning person.").count).toBe(3);
  });
  it('two repeats with a slip in between count two', () => {
    expect(countRepeats(A, "I'm not a morning person uh I'm not a morning person").count).toBe(2);
  });
});
