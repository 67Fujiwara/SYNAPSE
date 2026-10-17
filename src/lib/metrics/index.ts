// Session metrics (§3.5 of the spec). Simple, transparent, and cheap.

const FILLERS_EN = ['um', 'uh', 'er', 'hmm', 'you know', 'i mean'];
const FILLERS_JA = ['えーと', 'えっと', 'あの', 'その'];

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function wordCount(text: string): number {
  return tokenize(text).length;
}

/** Count fillers. "like" counts only at the start of a sentence or when repeated. */
export function countFillers(text: string): number {
  const lower = text.toLowerCase();
  let n = 0;
  for (const f of FILLERS_EN) {
    const re = new RegExp(`(^|[^a-z])${f.replace(' ', '\\s+')}(?=$|[^a-z])`, 'g');
    n += (lower.match(re) ?? []).length;
  }
  for (const f of FILLERS_JA) n += lower.split(f).length - 1;
  n += (lower.match(/(^|[.!?]\s*)like\b/g) ?? []).length; // sentence-initial "like"
  n += (lower.match(/\blike\s+like\b/g) ?? []).length; // "like like"
  return n;
}

export function uniqueWordCount(texts: string[]): number {
  const set = new Set<string>();
  for (const t of texts) for (const w of tokenize(t)) set.add(lemma(w));
  return set.size;
}

/** Very light lemmatizer: plural -s, -ing, -ed. Good enough for a trend line. */
export function lemma(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function sentenceCount(text: string): number {
  const n = text.split(/[.!?]+(\s|$)/).filter((s) => s.trim().length > 0).length;
  return Math.max(1, n);
}

const MAX_WPM = 300;

export interface UserTurnLike {
  text: string;
  startedAt: string;
  endedAt: string;
}

export interface ComputedMetrics {
  speakingSec: number;
  words: number;
  wpm: number;
  fillerRate: number;
  uniqueWords: number;
  avgSentLen: number;
}

/**
 * speakingSec comes from the recognizer's speech start/end spans (summed by the
 * caller). If it couldn't be measured, approximate from the user turns' durations.
 */
export function computeMetrics(userTurns: UserTurnLike[], measuredSpeakingSec: number | null): ComputedMetrics {
  const texts = userTurns.map((t) => t.text);
  const words = texts.reduce((a, t) => a + wordCount(t), 0);
  const fillers = texts.reduce((a, t) => a + countFillers(t), 0);
  const fromTurns = userTurns.reduce((a, t) => {
    const d = (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 1000;
    return a + (Number.isFinite(d) && d > 0 ? d : 0);
  }, 0);
  // Trust the recognizer's speech spans unless they are implausibly short for the
  // words heard (< 1 s per 10 words); then fall back to the turns' durations.
  const plausible = measuredSpeakingSec !== null && measuredSpeakingSec >= words / 10;
  let speakingSec = plausible ? (measuredSpeakingSec as number) : 0;
  if (!plausible) {
    speakingSec = fromTurns;
  }
  const minutes = speakingSec / 60;
  const sentences = texts.reduce((a, t) => a + sentenceCount(t), 0);
  return {
    speakingSec: round(speakingSec, 1),
    words,
    // Nobody speaks above ~300 wpm; anything higher means the timer missed speech.
    wpm: minutes > 0 ? Math.min(MAX_WPM, round(words / minutes, 1)) : 0,
    fillerRate: words > 0 ? round((fillers / words) * 100, 2) : 0,
    uniqueWords: uniqueWordCount(texts),
    avgSentLen: sentences > 0 ? round(words / sentences, 1) : 0,
  };
}

/** XP: 10 per speaking minute + 1 per 10 words, min 5 for any finished session. */
export function computeXp(m: ComputedMetrics): number {
  return Math.max(5, Math.round((m.speakingSec / 60) * 10 + m.words / 10));
}

function round(n: number, d: number): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
