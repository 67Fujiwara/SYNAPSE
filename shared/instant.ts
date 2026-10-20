// 瞬間英作文 (instant composition): level ladder shared by the Worker (drill generator
// prompt) and the app (timer, pass threshold, mastery). Keep the two in sync by
// importing from here only.

export type InstantLevel = 1 | 2 | 3 | 4 | 5;
/** What the learner sees. sentence = Japanese sentence; transform = English base + a change to make;
 *  situation = a Japanese description of what to say (no sentence given). */
export type CueKind = 'sentence' | 'transform' | 'situation';

export interface LevelSpec {
  level: InstantLevel;
  cueKind: CueKind;
  /** Seconds allowed before the first word; after that the item times out. */
  limitSec: number;
  /** A pass that starts speaking within this many seconds counts toward mastery. */
  fastSec: number;
  /** Minimum score (0..100) to pass. */
  passScore: number;
  /** Target length of the model answer in words. */
  words: [number, number];
  /** Short English brief for the generator prompt. */
  brief: string;
}

export const LEVELS: LevelSpec[] = [
  {
    level: 1,
    cueKind: 'sentence',
    limitSec: 6,
    fastSec: 2.0,
    passScore: 70,
    words: [4, 8],
    brief:
      'Short everyday sentences: be-verbs, present/past simple, simple questions and negatives, there is/are, want to / have to. Everyday vocabulary. One idea per sentence.',
  },
  {
    level: 2,
    cueKind: 'transform',
    limitSec: 5,
    fastSec: 2.0,
    passScore: 70,
    words: [6, 11],
    brief:
      'Pattern switching: the cue is a base English sentence and the transform names ONE change to make (negative / yes-no question / wh-question / past / future / present perfect / modal such as should, might, have to / passive / "if" clause / reported request). The answer is the transformed sentence. Everyday and light work topics.',
  },
  {
    level: 3,
    cueKind: 'sentence',
    limitSec: 4,
    fastSec: 1.5,
    passScore: 70,
    words: [9, 15],
    brief:
      'Work sentences for a controls / electrical engineer: relative clauses, conditionals, comparisons, reported requests, phrasal verbs, time expressions. Contexts: vendors and lead time, spec reviews, drawing revisions, troubleshooting, commissioning, safety (E-stop, interlock, LOTO), PLC/HMI.',
  },
  {
    level: 4,
    cueKind: 'situation',
    limitSec: 4,
    fastSec: 1.5,
    passScore: 60,
    words: [8, 16],
    brief:
      'Situation cue only: describe in Japanese what the learner must say (to whom, about what), without giving the sentence. Daily and work situations. Give 3 acceptable answers and 2–4 key phrases any good answer should contain.',
  },
  {
    level: 5,
    cueKind: 'situation',
    limitSec: 3,
    fastSec: 1.0,
    passScore: 60,
    words: [14, 28],
    brief:
      'Two-sentence responses: a situation that needs a point plus a reason, alternative or next step (decline + alternative, report + countermeasure, disagree + suggestion, ask + why). Natural spoken connectors (so, because, otherwise, instead, that way). Give 3 acceptable answers and 2–4 key phrases.',
  },
];

export function levelSpec(level: number): LevelSpec {
  return LEVELS.find((l) => l.level === level) ?? LEVELS[0];
}

/** Consecutive fast passes needed before an item is considered automatic. */
export const INSTANT_MASTER_COUNT = 3;

/** Mastery step: fast pass -> +1, fail -> 0, slow pass -> unchanged. */
export function nextMastered(prev: number, passed: boolean, latencySec: number, spec: LevelSpec): number {
  if (!passed) return 0;
  return latencySec <= spec.fastSec ? prev + 1 : prev;
}
