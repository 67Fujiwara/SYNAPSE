/**
 * Incremental sentence splitter for streamed text.
 * Feed tokens; it returns complete sentences as soon as a terminator is seen,
 * so TTS can start on sentence 1 while sentence 2 is still streaming.
 */
export class SentenceChunker {
  private buf = '';

  push(token: string): string[] {
    this.buf += token;
    const out: string[] = [];
    // Terminator (. ! ? …) optionally followed by closing quotes/brackets, then whitespace or newline.
    const re = /([.!?…]+["')\]]*)(\s+|\n)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buf))) {
      const end = m.index + m[1].length;
      const sentence = this.buf.slice(last, end).trim();
      if (sentence && !looksLikeAbbreviation(sentence)) {
        out.push(sentence);
        last = m.index + m[0].length;
      }
    }
    // Hard line breaks also end a sentence.
    const rest = this.buf.slice(last);
    const nl = rest.lastIndexOf('\n');
    if (nl >= 0) {
      const beforeNl = rest.slice(0, nl).trim();
      if (beforeNl) out.push(beforeNl);
      last += nl + 1;
    }
    this.buf = this.buf.slice(last);
    return out;
  }

  /** Flush whatever is left at end of stream. */
  flush(): string[] {
    const s = this.buf.trim();
    this.buf = '';
    return s ? [s] : [];
  }
}

const ABBREV = /\b(e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|St|No|approx|rev)\.$/i;
function looksLikeAbbreviation(s: string): boolean {
  return ABBREV.test(s);
}
