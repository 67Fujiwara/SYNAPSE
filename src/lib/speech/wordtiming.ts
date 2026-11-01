// Word-level timing for a synthesized sentence whose audio carries no timestamps (Deepgram Aura).
// The decoded audio tells us where the voice actually is (leading silence, pauses between phrases);
// the words are spread over that voiced time by syllable weight. Pure functions, unit-tested.

export interface Segment {
  /** Seconds, in media time. */
  start: number;
  end: number;
}

/** Rough English syllable count: vowel groups, minus a silent trailing "e" (make, drive) but not "-le" (table). */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  // Vowel groups, plus a "y" that carries its own syllable: one after a consonant (try, trying, happy),
  // not a word-initial y (yes) and not one glued to a vowel (Monday, key).
  let n = (w.match(/[aeiou]+/g) ?? []).length + (w.match(/[^aeiouy]y/g) ?? []).length;
  if (n > 1 && /[^aeiouy]e$/.test(w) && !/le$/.test(w)) n -= 1;
  return Math.max(1, n);
}

/** RMS per frame (frameSec) of mono samples. */
export function frameRms(samples: Float32Array, sampleRate: number, frameSec = 0.01): Float32Array {
  const n = Math.max(1, Math.round(sampleRate * frameSec));
  const out = new Float32Array(Math.ceil(samples.length / n));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    const end = Math.min(samples.length, (f + 1) * n);
    for (let i = f * n; i < end; i++) sum += samples[i] * samples[i];
    out[f] = Math.sqrt(sum / Math.max(1, end - f * n));
  }
  return out;
}

/**
 * Voiced stretches of the audio. A frame is voiced above `ratio` x the loudest frame; gaps shorter than
 * `mergeSec` are bridged (consonant closures), so what remains are phrase pauses and lead/tail silence.
 */
export function voicedSegments(rms: Float32Array, frameSec = 0.01, ratio = 0.08, mergeSec = 0.12, minSec = 0.05): Segment[] {
  let peak = 0;
  for (const v of rms) peak = Math.max(peak, v);
  if (peak === 0) return [];
  const thr = peak * ratio;
  const segs: Segment[] = [];
  let cur: Segment | null = null;
  for (let f = 0; f < rms.length; f++) {
    const t = f * frameSec;
    if (rms[f] >= thr) {
      if (cur && t - cur.end <= mergeSec) cur.end = t + frameSec;
      else {
        if (cur) segs.push(cur);
        cur = { start: t, end: t + frameSec };
      }
    }
  }
  if (cur) segs.push(cur);
  return segs.filter((s) => s.end - s.start >= minSec);
}

/**
 * Start time (media seconds) of each word. Words are weighted by syllables (+ a fixed onset cost) and laid
 * over the voiced time only, so leading silence and pauses never count as speech. When the text's phrases
 * (split at punctuation) match the number of voiced segments, each phrase gets its own segment.
 */
export function wordStarts(words: string[], segments: Segment[], totalSec: number): number[] {
  if (words.length === 0) return [];
  if (segments.length === 0) {
    // No voice found: spread evenly over the whole clip.
    return words.map((_, i) => (i / words.length) * totalSec);
  }
  const weight = (w: string) => syllables(w) + 0.6;
  // Phrases: split after a word that ends with punctuation.
  const phrases: string[][] = [[]];
  for (const w of words) {
    phrases[phrases.length - 1].push(w);
    if (/[,.;:!?—–]["')\]]*$/.test(w)) phrases.push([]);
  }
  const groups = phrases.filter((p) => p.length > 0);
  const out: number[] = [];
  if (groups.length > 1 && groups.length === segments.length) {
    groups.forEach((g, gi) => {
      const seg = segments[gi];
      const total = g.reduce((a, w) => a + weight(w), 0);
      let acc = 0;
      for (const w of g) {
        out.push(seg.start + (acc / total) * (seg.end - seg.start));
        acc += weight(w);
      }
    });
    return out;
  }
  // One timeline made of the voiced stretches glued together (pauses skipped).
  const voiced = segments.reduce((a, s) => a + (s.end - s.start), 0);
  const total = words.reduce((a, w) => a + weight(w), 0);
  const toMedia = (v: number): number => {
    let left = v;
    for (const s of segments) {
      const len = s.end - s.start;
      if (left <= len) return s.start + left;
      left -= len;
    }
    return segments[segments.length - 1].end;
  };
  let acc = 0;
  for (const w of words) {
    out.push(toMedia((acc / total) * voiced));
    acc += weight(w);
  }
  return out;
}

/** Index of the word being spoken at media time `t` (−1 before the first word). */
export function wordAt(starts: number[], t: number): number {
  let idx = -1;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= t) idx = i;
  return idx;
}
