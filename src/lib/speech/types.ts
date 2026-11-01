// Abstract interfaces so Web Speech API can be swapped for Whisper / external TTS later.

export interface RecognitionResult {
  /** Text finalized by the recognizer since the last final result. */
  final: string;
  /** Current unstable hypothesis (replaced on every event). */
  interim: string;
  /** Server engine: Date.now() when speech was first heard in the clip this text came from.
   *  Lets callers drop text from a clip that began before the current screen. */
  clipStartedAt?: number;
}

export interface VadOptions {
  /** RMS floor below which nothing counts as speech (default 0.02). */
  minThreshold?: number;
  /** Consecutive loud 50 ms frames before "speech started" (default 5). */
  startFrames?: number;
  /** Speech must be this many times louder than the running noise floor (default 4). */
  floorMult?: number;
  /** Highest value the noise floor may climb to (default 0.03). */
  floorCap?: number;
  /** Voiced time a clip needs before it is sent (default 600 ms). */
  minVoicedMs?: number;
  /** Longest clip (default 45 s). */
  maxMs?: number;
  /** Ask the server for its strict confidence gate (noisy place). */
  strict?: boolean;
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
  /** Drop whatever is being heard right now without transcribing it; keep listening if keepAlive is on. */
  discardClip(): void;
  /** stop() and give the microphone back to the OS. stop() alone keeps the mic open between turns
   *  (no re-permission on iOS, no audio-processing restart) — call this when the screen is done. */
  release(): void;
  /** While muted the mic stays open but nothing is detected or sent (use while the app plays audio). */
  setMuted(on: boolean): void;
  /** Optional: mic level 0..1 relative to the speech threshold, ~20 times a second. */
  onLevel?(cb: (level: number) => void): void;
  /** Optional: tune the voice-activity detector. */
  setVad?(opts: VadOptions): void;
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
