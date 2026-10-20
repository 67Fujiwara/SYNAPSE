-- Phase 4: instant composition (瞬間英作文) drills.
CREATE TABLE IF NOT EXISTS instant_items (
  id TEXT PRIMARY KEY,
  level INTEGER NOT NULL,
  cue_kind TEXT NOT NULL,
  cue TEXT NOT NULL,
  transform TEXT,
  answer TEXT NOT NULL,
  alternatives TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  hint TEXT,
  topic TEXT,
  source TEXT NOT NULL,
  due_at TEXT,
  interval_days INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  best_latency REAL,
  mastered_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_instant_items_level ON instant_items(level, due_at);

CREATE TABLE IF NOT EXISTS instant_attempts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  at TEXT NOT NULL,
  score INTEGER NOT NULL,
  latency_sec REAL NOT NULL DEFAULT 0,
  heard TEXT NOT NULL DEFAULT '',
  passed INTEGER NOT NULL DEFAULT 0,
  timed_out INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_instant_attempts_item ON instant_attempts(item_id, at);
CREATE INDEX IF NOT EXISTS idx_instant_attempts_at ON instant_attempts(at);
