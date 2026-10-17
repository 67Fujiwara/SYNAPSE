import type { SpeakOptions, Synthesizer } from './types';

/**
 * Web Speech API synthesizer. Utterances are queued by the browser; each
 * speak() resolves when its own utterance ends, so callers can chain
 * "sentence done" -> next action (e.g. resume recognition after the last one).
 */
export class WebSpeechSynthesizer implements Synthesizer {
  readonly supported: boolean;
  private active = 0;
  private cancelled = new Set<SpeechSynthesisUtterance>();

  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.supported) {
      // Chrome loads voices asynchronously; touching getVoices() kicks it off.
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }

  get speaking() {
    return this.active > 0;
  }

  voices(): SpeechSynthesisVoice[] {
    if (!this.supported) return [];
    return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  }

  pickVoice(name?: string): SpeechSynthesisVoice | undefined {
    const all = this.voices();
    if (name) {
      const v = all.find((x) => x.name === name);
      if (v) return v;
    }
    // Prefer a natural US voice when the user hasn't chosen one.
    const prefs = [/Google US English/i, /Natural/i, /Samantha/i, /Aria/i, /Jenny/i, /en-US/i];
    for (const p of prefs) {
      const v = all.find((x) => p.test(x.name) || p.test(x.lang));
      if (v) return v;
    }
    return all[0];
  }

  speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    if (!this.supported || !text.trim()) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = opts.lang ?? 'en-US';
      u.rate = opts.rate ?? 1;
      const voice = this.pickVoice(opts.voice);
      if (voice) u.voice = voice;
      this.active += 1;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.active = Math.max(0, this.active - 1);
        this.cancelled.delete(u);
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      // Safety: Chrome occasionally drops onend for long utterances.
      const guard = window.setTimeout(finish, 1000 + text.length * 120);
      u.onend = () => {
        window.clearTimeout(guard);
        finish();
      };
      window.speechSynthesis.speak(u);
    });
  }

  cancel() {
    if (!this.supported) return;
    window.speechSynthesis.cancel();
    this.active = 0;
  }
}
