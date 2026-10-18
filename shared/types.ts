// Types shared between the web app (src/) and the Worker (worker/).
// Dates are ISO-8601 strings in UTC; convert to local time only for display.

export type Mode = 'daily' | 'business' | 'mywork' | 'free';
export type Immersion = 'high' | 'medium' | 'low';
export type UiLang = 'en' | 'ja';
/** How the mic is driven. 'auto' = continuous on desktop, push-to-talk on iOS. */
export type MicMode = 'auto' | 'continuous' | 'push';
/** Where speech is recognized. 'server' records audio and sends it to /api/transcribe. */
export type SttEngine = 'browser' | 'server';

export interface Turn {
  id: string;
  sessionId: string;
  role: 'user' | 'ai';
  text: string;
  startedAt: string;
  endedAt: string;
}

export interface SessionMetrics {
  speakingSec: number;
  words: number;
  wpm: number;
  fillerRate: number; // fillers per 100 words
  errorRate: number; // review corrections per 100 words (0 until Phase 2)
  uniqueWords: number;
  avgSentLen: number;
  avgLatencySec: number; // AI speech end -> user speech start
  jpHintCount: number;
}

export interface Session extends SessionMetrics {
  id: string;
  mode: Mode;
  scenario?: string | null;
  startedAt: string;
  endedAt: string;
  xp: number;
}

export interface SessionPayload {
  session: Session;
  turns: Turn[];
}

export interface DailyStat {
  date: string; // YYYY-MM-DD (local date of the user when the session ended)
  speakingSec: number;
  words: number;
  sessions: number;
  missionDone: number;
}

export interface StatsResponse {
  today: DailyStat;
  streak: number;
  days: DailyStat[]; // ascending, last N days (zero-filled)
  totals: { sessions: number; speakingSec: number; words: number };
  recent: Session[];
}

export interface Settings {
  uiLang: UiLang;
  immersion: Immersion;
  voice: string; // SpeechSynthesis voice name ('' = auto)
  rate: number; // TTS rate 0.7..1.3
  silenceSec: number; // auto-send after this much silence
  manualSend: boolean;
  dailyGoalMin: number;
  chatModel: string;
  reviewModel: string;
  saveRecordings: boolean;
  micMode: MicMode;
  sttEngine: SttEngine;
}

export const DEFAULT_SETTINGS: Settings = {
  uiLang: 'en',
  immersion: 'high',
  voice: '',
  rate: 1.0,
  silenceSec: 1.2,
  manualSend: false,
  dailyGoalMin: 10,
  chatModel: 'claude-sonnet-5-5',
  reviewModel: 'claude-opus-5-5',
  saveRecordings: false,
  micMode: 'auto',
  sttEngine: 'browser',
};

// ---- /api/chat --------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  mode: Mode;
  immersion: Immersion;
  scenario?: string; // My Work: generated scenario text
  model?: string;
  messages: ChatMessage[];
}

/** SSE events emitted by /api/chat. `data:` is JSON of one of these. */
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; stopReason: string | null; model: string }
  | { type: 'error'; message: string };

// ---- Phase 2: review -----------------------------------------------------------

export type CorrectionTag = 'grammar' | 'vocabulary' | 'natural' | 'term';

export interface Correction {
  original: string;
  fixed: string;
  reason: string;
  tag: CorrectionTag;
}

export interface TermNote {
  heard: string;
  standard: string;
  note: string;
}

export interface Review {
  id: string;
  sessionId: string;
  corrections: Correction[];
  betterPhrases: string[];
  wins: string[];
  termNotes: TermNote[];
  createdAt: string;
}

/** Review list entry: the review plus the session it belongs to (for dates/mode). */
export interface ReviewSummary {
  review: Review;
  session: Pick<Session, 'id' | 'mode' | 'endedAt' | 'words' | 'speakingSec'>;
}

// ---- Phase 2: shadowing -----------------------------------------------------------

export type ShadowSource = 'conversation' | 'review' | 'bank' | 'manual';

export interface ShadowItem {
  id: string;
  text: string;
  source: ShadowSource;
  jaText: string | null;
  dueAt: string | null; // null = never attempted (due now)
  intervalDays: number;
  bestScore: number;
  bestWpm: number;
  masteredCount: number; // consecutive Recall-mode passes >= MASTER_SCORE
  attempts: number;
  createdAt: string;
}

export interface ShadowAttempt {
  id: string;
  itemId: string;
  at: string;
  score: number;
  wpm: number;
  speed: number;
  mode: ShadowMode;
}

export type ShadowMode = 'listen' | 'overlap' | 'shadow' | 'recall';

export interface NewShadowItem {
  text: string;
  source: ShadowSource;
  jaText?: string | null;
}

// ---- Phase 2: word popup ---------------------------------------------------------

export interface WordInfo {
  word: string;
  ipa: string;
  pos: string;
  definition: string;
  ja: string;
  example: string;
}
