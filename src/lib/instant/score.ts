// Scoring for instant composition: the learner's sentence against the model answer
// and its accepted alternatives (best wins); situation cues also check key phrases.
import { align, normalize, type AlignResult } from '@/lib/align';
import { levelSpec, type CueKind } from '@shared/instant';
import { expandContractions } from './contractions';

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
  const said = expandContractions(heard);
  let best: { ref: string; align: AlignResult } | null = null;
  for (const ref of refs) {
    // Align on expanded text, but keep the reference's own words for display.
    const a = align(expandContractions(ref), said);
    const shown = ref.split(/\s+/).filter(Boolean);
    const disp = shown.length === a.words.length ? a : { ...a, words: remap(ref, a) };
    if (!best || disp.score > best.align.score) best = { ref, align: disp };
  }
  const chosen = best ?? { ref: item.answer, align: align(item.answer, said) };
  const words = normalize(said);
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

/** Map per-word marks from the expanded reference back onto the original reference words. */
function remap(ref: string, a: AlignResult): AlignResult['words'] {
  const orig = ref.split(/\s+/).filter(Boolean);
  const out: AlignResult['words'] = [];
  let j = 0;
  for (const w of orig) {
    const n = Math.max(1, normalize(expandContractions(w)).length);
    const slice = a.words.slice(j, j + n);
    j += n;
    const marks = slice.map((x) => x.mark);
    const mark = marks.every((m) => m === 'match') ? 'match' : marks.some((m) => m === 'match' || m === 'near') ? 'near' : 'missing';
    out.push({ ref: w, mark, heard: slice.map((x) => x.heard).filter(Boolean).join(' ') || undefined });
  }
  return out;
}
