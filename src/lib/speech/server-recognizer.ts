import type { RecognitionResult, Recognizer } from './types';
import { api } from '../api/client';

/**
 * Push-to-talk recognizer that records with MediaRecorder and sends the clip to
 * /api/transcribe. No interim results; one final result per start()/stop() pair.
 * Works wherever MediaRecorder does (iOS Safari records audio/mp4).
 */
export class ServerRecognizer implements Recognizer {
  readonly supported: boolean;
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  private resultCb: (r: RecognitionResult) => void = () => {};
  private speechStartCb: () => void = () => {};
  private speechEndCb: () => void = () => {};
  private errorCb: (code: string) => void = () => {};
  private stateCb: (listening: boolean) => void = () => {};

  constructor() {
    this.supported = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  private pickMime(): string | undefined {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m));
  }

  start() {
    if (this.rec) return;
    void (async () => {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        this.errorCb('not-allowed');
        return;
      }
      const mime = this.pickMime();
      const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      this.rec = rec;
      this.chunks = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      rec.onstop = () => void this.finish(rec.mimeType);
      rec.start(250);
      this.startedAt = Date.now();
      this.stateCb(true);
      this.speechStartCb();
    })();
  }

  stop() {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    this.speechEndCb();
    this.stateCb(false);
    if (rec.state !== 'inactive') rec.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private async finish(mime: string) {
    const blob = new Blob(this.chunks, { type: mime || 'audio/webm' });
    this.chunks = [];
    if (Date.now() - this.startedAt < 400 || blob.size < 1000) return; // a tap, not speech
    try {
      const text = await api.transcribe(blob);
      if (text) this.resultCb({ final: text, interim: '' });
    } catch (e) {
      this.errorCb(e instanceof Error ? e.message : 'transcribe-failed');
    }
  }

  setKeepAlive() {
    /* push-to-talk never auto-restarts */
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
