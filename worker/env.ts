export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS?: Fetcher;
  ANTHROPIC_API_KEY: string;
  /** Required when the API key is user-scoped (sk-ant-usr-…) rather than workspace-scoped. */
  ANTHROPIC_WORKSPACE_ID?: string;
  APP_TOKEN: string;
  DEFAULT_CHAT_MODEL?: string;
  DEFAULT_REVIEW_MODEL?: string;
  /** Optional server-side speech-to-text (OpenAI-compatible /audio/transcriptions). */
  STT_API_KEY?: string;
  STT_BASE_URL?: string;
  STT_MODEL?: string;
}
