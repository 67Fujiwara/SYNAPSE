import type { SpeakOptions, Synthesizer } from './types';
import { api } from '../api/client';

let silentUrl: string | null = null;
/** 100 ms of real 16-bit silence as a WAV blob URL (built once). */
function silentWavUrl(): string {
  if (silentUrl) return silentUrl;
  const sr = 8000;
  const n = sr / 10;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentUrl;
}

interface Item {
  text: string;
  voice: string;
  rate: number;
  audio: Promise<Blob>;
  resolve: () => void;
  cancelled: boolean;
}

/**
 * Plays sentences synthesized by the Worker (/api/tts). Each speak() prefetches
 * its audio immediately and plays strictly in order, so streamed sentences
 * sound continuous. Because the browser renders the audio, Chrome's echo
 * cancellation can remove it from the mic signal (unlike speechSynthesis).
 */
export class ServerSynthesizer implements Synthesizer {
  readonly supported = typeof window !== 'undefined' && typeof Audio !== 'undefined';
  private queue: Item[] = [];
  private current: HTMLAudioElement | null = null;
  private running = false;
  private unlocked = false;
  private generation = 0;

  constructor(private defaultVoice = 'thalia') {}

  get speaking() {
    return this.running;
  }

  voices(): SpeechSynthesisVoice[] {
    return [];
  }

  /**
   * iOS/Safari let a page start audio only inside a user gesture, and then only
   * on an element that already played. We keep one hidden <audio> element for
   * life and prime it with 100 ms of real silence inside the gesture; later
   * sentences just swap its src. (An empty data-URI clip must NOT be used here:
   * it leaves the element in a state that stalls the next playback.)
   */
  unlock() {
    if (!this.supported || this.unlocked) return;
    this.unlocked = true;
    try {
      const el = this.element();
      el.src = silentWavUrl();
      el.volume = 0;
      void el.play().catch(() => {});
      el.onended = () => {
        el.volume = 1;
      };
    } catch {
      /* ignore */
    }
  }

  private el: HTMLAudioElement | null = null;
  private element(): HTMLAudioElement {
    if (!this.el) {
      this.el = new Audio();
      this.el.style.display = 'none';
      this.el.preload = 'auto';
      document.body.appendChild(this.el);
    }
    return this.el;
  }

  speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    if (!this.supported || !text.trim()) return Promise.resolve();
    const voice = opts.voice || this.defaultVoice;
    return new Promise<void>((resolve) => {
      const item: Item = { text, voice, rate: opts.rate ?? 1, audio: api.tts(text, voice), resolve, cancelled: false };
      item.audio.catch(() => {}); // avoid unhandled rejection; handled in play loop
      this.queue.push(item);
      void this.pump();
    });
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    while (this.queue.length && gen === this.generation) {
      const item = this.queue.shift()!;
      if (item.cancelled) {
        item.resolve();
        continue;
      }
      try {
        const blob = await item.audio;
        if (item.cancelled || gen !== this.generation) {
          item.resolve();
          continue;
        }
        await this.play(blob, item.rate);
      } catch {
        /* network / TTS failure: skip the sentence */
      }
      item.resolve();
    }
    this.running = false;
  }

  private play(blob: Blob, rate: number): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = this.element();
      a.onended = null;
      a.onerror = null;
      a.onloadedmetadata = null;
      a.pause();
      a.src = url;
      a.volume = 1;
      a.playbackRate = Math.max(0.5, Math.min(2, rate));
      this.current = a;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(guard);
        URL.revokeObjectURL(url);
        if (this.current === a) this.current = null;
        resolve();
      };
      a.onended = done;
      a.onerror = done;
      // Safety net if `ended` never arrives.
      const arm = () => window.setTimeout(done, ((Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 30) / a.playbackRate) * 1000 + 1500);
      let guard = arm();
      a.onloadedmetadata = () => {
        window.clearTimeout(guard);
        guard = arm();
      };
      a.play().catch(done);
    });
  }

  cancel() {
    this.generation += 1;
    for (const it of this.queue) {
      it.cancelled = true;
      it.resolve();
    }
    this.queue = [];
    if (this.current) {
      try {
        this.current.pause();
        this.current.onended = null;
        this.current.onerror = null;
        this.current.removeAttribute('src');
        this.current.load();
      } catch {
        /* ignore */
      }
      this.current = null;
    }
    this.running = false;
  }
}
