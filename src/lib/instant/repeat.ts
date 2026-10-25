// Count how many times the learner echoed the model answer in one recognized chunk.
// Whisper returns a whole clip at once, so "three quick repeats" can arrive as one text.
import { align, normalize } from '@/lib/align';
import { expandContractions } from './contractions';

export const REPEAT_PASS = 75;

export function countRepeats(answerRaw: string, heardRaw: string, max = 3, pass = REPEAT_PASS): { count: number; best: number } {
  const answer = expandContractions(answerRaw);
  const heard = expandContractions(heardRaw);
  const n = normalize(answer).length;
  const words = normalize(heard);
  if (n === 0 || words.length === 0) return { count: 0, best: 0 };
  // Whole chunk first (the common case: one repeat per clip).
  const whole = align(answer, heard).score;
  if (words.length <= n + 2) return { count: whole >= pass ? 1 : 0, best: whole };
  // Several repeats in one chunk: slide a window of the answer's length.
  let count = 0;
  let best = whole;
  let i = 0;
  while (i + Math.max(1, n - 1) <= words.length && count < max) {
    const win = words.slice(i, i + n).join(' ');
    const s = align(answer, win).score;
    best = Math.max(best, s);
    if (s >= pass) {
      count += 1;
      i += n;
    } else i += 1;
  }
  return { count, best };
}
