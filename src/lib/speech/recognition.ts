import type { RecognitionResult, Recognizer } from './types';

type SR = { new (): SpeechRecognition };

function getCtor(): SR | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

/**
 * Web Speech API recognizer (Chrome / Edge).
 * continuous + interimResults; auto-restarts while keepAlive is on because
 * Chrome ends the session after ~60s of audio or a few seconds of silence.
 */
export class WebSpeechRecognizer implements Recognizer {
  readonly supported: boolean;
  private rec: SpeechRecognition | null = null;
  private keepAlive = false;
  private wantListening = false;
  private listening = false;
  private restartTimer: number | null = null;

  private resultCb: (r: RecognitionResult) => void = () => {};
  private speechStartCb: () => void = () => {};
  private speechEndCb: () => void = () => {};
  private errorCb: (code: string) => void = () => {};
  private stateCb: (listening: boolean) => void = () => {};

  constructor(private lang = 'en-US') {
    this.supported = Boolean(getCtor());
  }

  private create(): SpeechRecognition | null {
    const Ctor = getCtor();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let final = '';
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) final += t;
        else interim += t;
      }
      this.resultCb({ final: final.trim(), interim: interim.trim() });
    };
    rec.onspeechstart = () => this.speechStartCb();
    rec.onspeechend = () => this.speechEndCb();
    rec.onstart = () => this.setListening(true);
    rec.onend = () => {
      this.setListening(false);
      this.rec = null;
      if (this.wantListening && this.keepAlive) this.scheduleRestart(150);
    };
    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      // 'no-speech' and 'aborted' are routine; the watchdog restarts us.
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      this.errorCb(ev.error);
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        this.wantListening = false;
      }
    };
    return rec;
  }

  private setListening(v: boolean) {
    if (this.listening === v) return;
    this.listening = v;
    this.stateCb(v);
  }

  private scheduleRestart(ms: number) {
    if (this.restartTimer !== null) window.clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null;
      if (this.wantListening) this.start();
    }, ms);
  }

  start() {
    this.wantListening = true;
    if (this.rec) return; // already running
    const rec = this.create();
    if (!rec) return;
    this.rec = rec;
    try {
      rec.start();
    } catch {
      // "already started" race; try again shortly
      this.rec = null;
      this.scheduleRestart(300);
    }
  }

  stop() {
    this.wantListening = false;
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      try {
        rec.onend = null;
        rec.abort();
      } catch {
        /* ignore */
      }
    }
    this.setListening(false);
  }

  setKeepAlive(on: boolean) {
    this.keepAlive = on;
  }
  onResult(cb: (r: RecognitionResult) => void) {
    this.resultCb = cb;
  }
  onSpeechStart(cb: () => void) {
    this.speechStartCb = cb;
  }
  onSpeechEnd(cb: () => void) {
    this.speechEndCb = cb;
  }
  onError(cb: (code: string) => void) {
    this.errorCb = cb;
  }
  onStateChange(cb: (listening: boolean) => void) {
    this.stateCb = cb;
  }
}
