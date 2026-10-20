// Scoring for instant composition: the learner's sentence against the model answer
// and its accepted alternatives (best wins); situation cues also check key phrases.
import { align, normalize, type AlignResult } from '@/lib/align';
import { levelSpec, type CueKind } from '@shared/instant';

export interface ScoreInput {
  level: number;
  cueKind: CueKind;
  answer: string;
  alternatives: string[];
  keywords: string[];
}

export interface ScoreResult {
  score: number;
  /** The reference the learner was closest to (model answer or an alternative). */
  ref: string;
  align: AlignResult;
  keywordHits: string[];
  keywordMisses: string[];
  passed: boolean;
}

/** True when every word of `phrase` appears in order and adjacent in `words`. */
export function containsPhrase(words: string[], phrase: string): boolean {
  const p = normalize(phrase);
  if (p.length === 0) return true;
  outer: for (let i = 0; i + p.length <= words.length; i++) {
    for (let j = 0; j < p.length; j++) if (words[i + j] !== p[j]) continue outer;
    return true;
  }
  return false;
}

export function scoreAnswer(item: ScoreInput, heard: string): ScoreResult {
  const spec = levelSpec(item.level);
  const refs = [item.answer, ...item.alternatives.filter(Boolean)];
  let best: { ref: string; align: AlignResult } | null = null;
  for (const ref of refs) {
    const a = align(ref, heard);
    if (!best || a.score > best.align.score) best = { ref, align: a };
  }
  const chosen = best ?? { ref: item.answer, align: align(item.answer, heard) };
  const words = normalize(heard);
  const keywordHits: string[] = [];
  const keywordMisses: string[] = [];
  for (const k of item.keywords) (containsPhrase(words, k) ? keywordHits : keywordMisses).push(k);

  let score = chosen.align.score;
  if (item.cueKind === 'situation' && item.keywords.length > 0) {
    // Free answers: half "how close to a model answer", half "did the must-say phrases come out".
    const coverage = (keywordHits.length / item.keywords.length) * 100;
    score = Math.round(0.5 * chosen.align.score + 0.5 * coverage);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, ref: chosen.ref, align: chosen.align, keywordHits, keywordMisses, passed: score >= spec.passScore };
}
