import { describe, expect, it } from 'vitest';
import { containsPhrase, scoreAnswer } from './score';
import { normalize } from '@/lib/align';
import { nextMastered, levelSpec } from '@shared/instant';

const sentence = { level: 1, cueKind: 'sentence' as const, answer: "I'm not a morning person.", alternatives: ["I am not a morning person."], keywords: [] };
const situation = {
  level: 4,
  cueKind: 'situation' as const,
  answer: 'Could you move the delivery up by a week?',
  alternatives: ['Is there any way to deliver a week earlier?', 'Can we get it one week sooner?'],
  keywords: ['could you', 'a week'],
};

describe('scoreAnswer', () => {
  it('passes an exact match', () => {
    const r = scoreAnswer(sentence, "I'm not a morning person");
    expect(r.score).toBe(100);
    expect(r.passed).toBe(true);
  });
  it('picks the closest of model answer and alternatives', () => {
    const r = scoreAnswer(sentence, 'I am not a morning person');
    expect(r.ref).toBe('I am not a morning person.');
    expect(r.score).toBe(100);
  });
  it('fails a different sentence', () => {
    const r = scoreAnswer(sentence, 'I like coffee a lot');
    expect(r.passed).toBe(false);
  });
  it('situation cues blend alignment and key phrases', () => {
    const r = scoreAnswer(situation, 'Could you move the delivery up by a week');
    expect(r.keywordHits).toEqual(['could you', 'a week']);
    expect(r.score).toBe(100);
    const partial = scoreAnswer(situation, 'Could you send it faster please');
    expect(partial.keywordHits).toEqual(['could you']);
    expect(partial.keywordMisses).toEqual(['a week']);
    expect(partial.passed).toBe(false);
  });
  it('a different wording that hits the key phrases can still pass at level 4', () => {
    const r = scoreAnswer(situation, 'Could you deliver it a week earlier than planned');
    expect(r.keywordHits.length).toBe(2);
    expect(r.passed).toBe(true);
  });
});

describe('containsPhrase', () => {
  it('matches adjacent words in order only', () => {
    const w = normalize("Could you please move it up by a week?");
    expect(containsPhrase(w, 'could you')).toBe(true);
    expect(containsPhrase(w, 'a week')).toBe(true);
    expect(containsPhrase(w, 'you could')).toBe(false);
  });
});

describe('nextMastered', () => {
  const spec = levelSpec(3); // fastSec 1.5
  it('counts fast passes, keeps slow passes, resets on a miss', () => {
    expect(nextMastered(0, true, 1.0, spec)).toBe(1);
    expect(nextMastered(1, true, 2.5, spec)).toBe(1);
    expect(nextMastered(2, false, 0.5, spec)).toBe(0);
  });
});
