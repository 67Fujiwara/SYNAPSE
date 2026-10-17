export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ANTHROPIC_API_KEY: string;
  APP_TOKEN: string;
  DEFAULT_CHAT_MODEL?: string;
  DEFAULT_REVIEW_MODEL?: string;
}
