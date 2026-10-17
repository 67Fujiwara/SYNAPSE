-- SYNAPSE D1 schema (Phase 1 + tables reserved for Phase 2/3).
-- Applied with: wrangler d1 migrations apply synapse-db --local | --remote

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  mode            TEXT NOT NULL,
  scenario        TEXT,
  started_at      TEXT NOT NULL,
  ended_at        TEXT NOT NULL,
  speaking_sec    REAL NOT NULL DEFAULT 0,
  words           INTEGER NOT NULL DEFAULT 0,
  wpm             REAL NOT NULL DEFAULT 0,
  filler_rate     REAL NOT NULL DEFAULT 0,
  error_rate      REAL NOT NULL DEFAULT 0,
  unique_words    INTEGER NOT NULL DEFAULT 0,
  avg_sent_len    REAL NOT NULL DEFAULT 0,
  avg_latency_sec REAL NOT NULL DEFAULT 0,
  jp_hint_count   INTEGER NOT NULL DEFAULT 0,
  xp              INTEGER NOT NULL DEFAULT 0,
  local_date      TEXT NOT NULL            -- YYYY-MM-DD in the user's local time
);
CREATE INDEX IF NOT EXISTS idx_sessions_local_date ON sessions(local_date);
CREATE INDEX IF NOT EXISTS idx_sessions_ended_at ON sessions(ended_at);

CREATE TABLE IF NOT EXISTS turns (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user','ai')),
  text        TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT NOT NULL,
  seq         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, seq);

CREATE TABLE IF NOT EXISTS daily_stats (
  date          TEXT PRIMARY KEY,           -- YYYY-MM-DD local
  speaking_sec  REAL NOT NULL DEFAULT 0,
  words         INTEGER NOT NULL DEFAULT 0,
  sessions      INTEGER NOT NULL DEFAULT 0,
  mission_done  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                        -- JSON
);

-- Phase 2 ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  corrections    TEXT NOT NULL,              -- JSON [{original, fixed, reason, tag}]
  better_phrases TEXT NOT NULL,              -- JSON string[]
  wins           TEXT NOT NULL,              -- JSON string[]
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shadow_items (
  id             TEXT PRIMARY KEY,
  text           TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('conversation','review','bank','manual')),
  ja_text        TEXT,
  due_at         TEXT,
  interval_days  INTEGER NOT NULL DEFAULT 0,
  best_score     REAL NOT NULL DEFAULT 0,
  best_wpm       REAL NOT NULL DEFAULT 0,
  mastered_count INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shadow_attempts (
  id       TEXT PRIMARY KEY,
  item_id  TEXT NOT NULL REFERENCES shadow_items(id) ON DELETE CASCADE,
  at       TEXT NOT NULL,
  score    REAL NOT NULL,
  wpm      REAL NOT NULL,
  speed    REAL NOT NULL
);

-- Phase 3 ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recordings (
  id           TEXT PRIMARY KEY,
  turn_id      TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL,
  duration_sec REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
