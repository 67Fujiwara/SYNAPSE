// Abstract interfaces so Web Speech API can be swapped for Whisper / external TTS later.

export interface RecognitionResult {
  /** Text finalized by the recognizer since the last final result. */
  final: string;
  /** Current unstable hypothesis (replaced on every event). */
  interim: string;
}

export interface Recognizer {
  readonly supported: boolean;
  start(): void;
  stop(): void;
  /** Lets the orchestrator know whether to auto-restart (Chrome stops after a while). */
  setKeepAlive(on: boolean): void;
  onResult(cb: (r: RecognitionResult) => void): void;
  onSpeechStart(cb: () => void): void;
  onSpeechEnd(cb: () => void): void;
  onError(cb: (code: string) => void): void;
  onStateChange(cb: (listening: boolean) => void): void;
}

export interface SpeakOptions {
  rate?: number;
  voice?: string;
  lang?: string;
}

export interface Synthesizer {
  readonly supported: boolean;
  /** Queue one sentence. Resolves when THIS utterance has finished (or was cancelled). */
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  /** Stop everything and drop the queue. */
  cancel(): void;
  voices(): SpeechSynthesisVoice[];
  readonly speaking: boolean;
  /** Call inside a user gesture (iOS) before any later playback. */
  unlock(): void;
}
