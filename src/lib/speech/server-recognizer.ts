import type { RecognitionResult, Recognizer, VadOptions } from './types';
import { api } from '../api/client';

/**
 * Server-side recognizer: records with MediaRecorder and posts the clip to
 * /api/transcribe (Whisper on Workers AI or an external API).
 *
 * A small voice-activity detector (RMS of the mic signal) ends the clip after
 * `silenceMs` of quiet following speech, so it works hands-free like the
 * browser recognizer. With keepAlive on, it starts a new clip after each one.
 * Works wherever MediaRecorder does (iOS Chrome/Safari record audio/mp4).
 */
// iOS only lets getUserMedia / AudioContext start inside a tap. Screens that start the mic
// later (after a state update or a fetch) call primeMic() in the tap and the recognizer
// picks up the result here.
let primedStream: Promise<MediaStream> | null = null;
let primedCtx: AudioContext | null = null;

export function primeMic() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  if (!primedStream) {
    primedStream = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    primedStream.catch(() => {
      primedStream = null;
    });
  }
  try {
    if (!primedCtx || primedCtx.state === 'closed') primedCtx = new AudioContext();
    if (primedCtx.state === 'suspended') void primedCtx.resume();
  } catch {
    primedCtx = null;
  }
}

function takePrimedStream(): Promise<MediaStream> | null {
  const p = primedStream;
  primedStream = null;
  return p;
}
function takePrimedCtx(): AudioContext | null {
  const c = primedCtx;
  primedCtx = null;
  return c;
}

export class ServerRecognizer implements Recognizer {
  readonly supported: boolean;
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadTimer: number | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private speechAt = 0; // when speech was first detected in this clip
  private lastLoudAt = 0;
  private loudMs = 0; // total time above threshold in this clip
  private loudRun = 0; // consecutive loud frames (to ignore clicks and bumps)
  private noiseFloor = 0.01;
  private minThreshold = 0.02;
  private startFrames = 5;
  private muted = false;
  private discard = false; // drop the current clip in finish()
  private keepAlive = false;
  private wantListening = false;
  private busy = 0; // uploads in flight
  /** The AI's last line, sent with each clip so Whisper knows the context. */
  context = '';
  /** Last clip that was sent (for the "play what the mic heard" debug button). */
  lastClip: Blob | null = null;
  onClip: (blob: Blob, text: string) => void = () => {};

  private resultCb: (r: RecognitionResult) => void = () => {};
  private speechStartCb: () => void = () => {};
  private speechEndCb: () => void = () => {};
  private errorCb: (code: string) => void = () => {};
  private stateCb: (listening: boolean) => void = () => {};
  private levelCb: (level: number) => void = () => {};

  constructor(
    private silenceMs = 1200,
    private maxMs = 45_000,
  ) {
    this.supported = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  setSilence(ms: number) {
    this.silenceMs = ms;
  }

  setVad(opts: VadOptions) {
    if (opts.minThreshold !== undefined) this.minThreshold = opts.minThreshold;
    if (opts.startFrames !== undefined) this.startFrames = opts.startFrames;
  }

  /** End the current clip without sending it. A new clip starts if keepAlive is on. */
  discardClip() {
    if (!this.rec) return;
    this.discard = true;
    this.endClip();
  }

  setMuted(on: boolean) {
    if (this.muted === on) return;
    this.muted = on;
    // Either way the clip in progress holds audio we don't want (our own playback, or its tail).
    this.discardClip();
    if (!on && this.wantListening && !this.rec) this.start();
  }

  onLevel(cb: (level: number) => void) {
    this.levelCb = cb;
  }

  private pickMime(): string | undefined {
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
  }

  start() {
    this.wantListening = true;
    if (this.rec) return;
    void (async () => {
      try {
        this.stream ??= await (takePrimedStream() ?? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
      } catch {
        this.wantListening = false;
        this.errorCb('not-allowed');
        return;
      }
      if (!this.wantListening) return; // stopped while waiting for permission
      const mime = this.pickMime();
      const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      this.rec = rec;
      this.chunks = [];
      this.speechAt = 0;
      this.loudMs = 0;
      this.loudRun = 0;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      rec.onstop = () => void this.finish(rec.mimeType);
      rec.start(); // one complete container per clip (safer than timeslices, esp. mp4 on iOS)
      this.startedAt = Date.now();
      this.stateCb(true);
      this.startVad();
    })();
  }

  /** Stop the current clip (it is transcribed) and don't start another until start() is called. */
  stop() {
    this.wantListening = false;
    this.endClip();
  }

  private endClip() {
    this.stopVad();
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    if (this.speechAt) this.speechEndCb();
    this.stateCb(false);
    if (rec.state !== 'inactive') rec.stop(); // -> onstop -> finish()
  }

  // ---- voice activity detection ------------------------------------------------------------
  private startVad() {
    if (!this.stream) return;
    try {
      this.ctx ??= takePrimedCtx() ?? new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (!this.analyser) {
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
      }
    } catch {
      return; // no VAD: the caller's hard stop / tap still works
    }
    const buf = new Float32Array(this.analyser.fftSize);
    this.lastLoudAt = Date.now();
    this.vadTimer = window.setInterval(() => {
      if (!this.analyser || !this.rec) return;
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      // Adaptive floor: follow quiet levels slowly, never above a sane cap.
      if (rms < this.noiseFloor) this.noiseFloor = this.noiseFloor * 0.9 + rms * 0.1;
      else this.noiseFloor = Math.min(0.03, this.noiseFloor * 0.995 + rms * 0.005);
      const threshold = Math.max(this.minThreshold, this.noiseFloor * 4);
      this.levelCb(Math.min(1, rms / (threshold * 2)));
      const now = Date.now();
      if (this.muted) {
        this.loudRun = 0;
        return;
      }
      if (rms > threshold) {
        this.lastLoudAt = now;
        this.loudRun += 1;
        this.loudMs += 50;
        // Speech starts only after sustained sound (startFrames x 50 ms), not on a click or a bump.
        if (!this.speechAt && this.loudRun >= this.startFrames) {
          this.speechAt = now;
          this.speechStartCb();
        }
      } else {
        this.loudRun = 0;
      }
      if (this.speechAt && now - this.lastLoudAt > this.silenceMs) {
        this.endClip(); // speech, then silence -> done
        return;
      }
      if (now - this.startedAt > this.maxMs) this.endClip();
    }, 50);
  }

  private stopVad() {
    if (this.vadTimer !== null) {
      window.clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
  }

  // ---- upload --------------------------------------------------------------------------------
  private async finish(mime: string) {
    const blob = new Blob(this.chunks, { type: mime || 'audio/webm' });
    this.chunks = [];
    const clipStartedAt = this.speechAt || this.startedAt;
    if (this.discard) {
      this.discard = false;
      this.speechAt = 0;
      this.loudMs = 0;
      if (this.wantListening && this.keepAlive && !this.muted) this.start();
      else if (this.wantListening && this.keepAlive) {
        /* muted: a new clip starts on unmute */
      } else this.releaseMic();
      return;
    }
    // Without VAD we trust the caller; with it we need real voiced time (>= 600 ms), not a cough.
    const hadSpeech = !this.analyser || (this.speechAt > 0 && this.loudMs >= 600);
    const next = () => {
      if (this.wantListening && this.keepAlive) this.start();
      else this.releaseMic();
    };
    if (!hadSpeech || Date.now() - this.startedAt < 400 || blob.size < 1000) return next();
    this.busy += 1;
    this.lastClip = blob;
    try {
      const text = await api.transcribe(blob, this.context);
      this.onClip(blob, text);
      if (text) this.resultCb({ final: text, interim: '', clipStartedAt });
    } catch (e) {
      this.errorCb(e instanceof Error ? e.message : 'transcribe-failed');
    } finally {
      this.busy -= 1;
      next();
    }
  }

  private releaseMic() {
    if (this.rec || this.busy > 0 || this.wantListening) return;
    this.stopVad();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    void this.ctx?.close();
    this.ctx = null;
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
