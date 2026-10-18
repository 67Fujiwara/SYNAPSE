// Shadowing score (§4.2): normalize -> word-level Levenshtein alignment ->
// per-word match / near / missing / extra, score = matches / len(ref).

export type WordMark = 'match' | 'near' | 'missing';

export interface AlignedWord {
  ref: string;
  mark: WordMark;
  /** What the learner said for this slot (for 'near' / substitutions). */
  heard?: string;
}

export interface AlignResult {
  words: AlignedWord[];
  /** Words the learner said that match nothing in the reference. */
  extras: string[];
  matches: number;
  near: number;
  score: number; // 0..100
}

const NUMBERS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen',
  '18': 'eighteen', '19': 'nineteen', '20': 'twenty', '30': 'thirty', '40': 'forty', '50': 'fifty', '60': 'sixty', '70': 'seventy',
  '80': 'eighty', '90': 'ninety', '100': 'hundred', '1000': 'thousand',
};

/** Spelling variants treated as the same word. Contractions are NOT expanded on purpose. */
const EQUIV: Record<string, string> = {
  ok: 'okay', 'o.k.': 'okay', gonna: 'going to', wanna: 'want to', gotta: 'got to', kinda: 'kind of', sorta: 'sort of',
  yeah: 'yes', yep: 'yes', yup: 'yes', nope: 'no', cause: 'because', "'cause": 'because', till: 'until', "'til": 'until',
  color: 'colour', favorite: 'favourite', center: 'centre', meter: 'metre',
};

export function normalize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean)
    .map((w) => NUMBERS[w] ?? w)
    .flatMap((w) => (EQUIV[w] ?? w).split(' '));
  return words;
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array<boolean>(a.length).fill(false);
  const bM = new Array<boolean>(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = bM[j] = true;
      m++;
      break;
    }
  }
  if (m === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  const jaro = (m / a.length + m / b.length + (m - t) / m) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length) && a[i] === b[i]; i++) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

const NEAR = 0.85;

export function align(refText: string, hypText: string): AlignResult {
  const ref = normalize(refText);
  const hyp = normalize(hypText);
  const n = ref.length;
  const m = hyp.length;
  // Levenshtein DP with cost 1 for sub/ins/del (equal or near words cost 0 / 0.5).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = i;
  for (let j = 1; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = ref[i - 1] === hyp[j - 1];
      const sub = same ? 0 : jaroWinkler(ref[i - 1], hyp[j - 1]) >= NEAR ? 0.5 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + sub);
    }
  }
  // Backtrace.
  const words: AlignedWord[] = new Array(n);
  const extras: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = ref[i - 1] === hyp[j - 1];
      const sim = same ? 1 : jaroWinkler(ref[i - 1], hyp[j - 1]);
      const sub = same ? 0 : sim >= NEAR ? 0.5 : 1;
      if (dp[i][j] === dp[i - 1][j - 1] + sub) {
        words[i - 1] = same ? { ref: ref[i - 1], mark: 'match' } : sim >= NEAR ? { ref: ref[i - 1], mark: 'near', heard: hyp[j - 1] } : { ref: ref[i - 1], mark: 'missing', heard: hyp[j - 1] };
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      words[i - 1] = { ref: ref[i - 1], mark: 'missing' };
      i--;
    } else {
      extras.unshift(hyp[j - 1]);
      j--;
    }
  }
  const matches = words.filter((w) => w.mark === 'match').length;
  const near = words.filter((w) => w.mark === 'near').length;
  const score = n ? Math.round(((matches + near * 0.5) / n) * 100) : 0;
  return { words, extras, matches, near, score };
}

/** +5 when the learner's duration is within ±20% of the reference duration. */
export function timingBonus(learnerSec: number, referenceSec: number): number {
  if (!learnerSec || !referenceSec) return 0;
  const r = learnerSec / referenceSec;
  return r >= 0.8 && r <= 1.2 ? 5 : 0;
}

export { nextInterval } from '@shared/srs';
