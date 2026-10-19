/**
 * Whisper invents subtitle boilerplate when a clip holds no speech
 * ("Thanks for watching", "Capture by GetTranscribed.com", "Subtitles by …").
 * This filter runs in the Worker (and is unit-tested) before a transcript is
 * accepted as something the learner said.
 */
const PATTERNS: RegExp[] = [
  /getranscribed|gettranscribed/i,
  /\b(thanks?|thank you) for watching\b/i,
  /\bsubtitles? (by|provided|created)\b/i,
  /\bsubscribe\b.*\b(channel|like)\b|\blike and subscribe\b/i,
  /\bcaption(s|ed|ing)? (by|provided)\b/i,
  /\btranscri(bed|ption) by\b/i,
  /\bamara\.org\b|\bwww\.[a-z0-9-]+\.(com|org|net)\b|\b[a-z0-9-]+\.(com|org|net)\b/i,
  /\bcopyright\b|©|\ball rights reserved\b/i,
  /^\s*[\[(](blank_audio|music|applause|laughter|inaudible|silence)[\])]\s*$/i,
  /^[\s.♪♫…\-—]*$/, // only punctuation / music notes
  /\bsee you (in the )?next (time|video)\b/i,
  /\bplease (like|subscribe)\b/i,
  /^(you|bye|thank you|thanks)\.?$/i, // classic single-word fillers from near-silent clips
];

/** True when the text looks like a Whisper hallucination rather than speech. */
export function looksHallucinated(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (PATTERNS.some((re) => re.test(t))) return true;
  // The same short phrase repeated (e.g. "Capture by X Capture by X").
  const words = t.toLowerCase().split(/\s+/);
  if (words.length >= 4) {
    for (let n = 1; n <= Math.floor(words.length / 2); n++) {
      const chunk = words.slice(0, n).join(' ');
      let repeats = 0;
      for (let i = 0; i + n <= words.length; i += n) if (words.slice(i, i + n).join(' ') === chunk) repeats++;
      if (repeats * n === words.length && repeats >= 2) return true;
    }
  }
  return false;
}

/** Drop transcripts whose segments Whisper itself flags as probably not speech. */
export function lowConfidence(segments: { no_speech_prob?: number; avg_logprob?: number }[] | undefined): boolean {
  if (!segments || segments.length === 0) return false;
  const noSpeech = segments.reduce((a, s) => a + (s.no_speech_prob ?? 0), 0) / segments.length;
  const logprob = segments.reduce((a, s) => a + (s.avg_logprob ?? 0), 0) / segments.length;
  return noSpeech > 0.6 || logprob < -1.0;
}
