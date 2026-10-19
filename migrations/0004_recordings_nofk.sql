-- Recordings are uploaded while the session is still in progress (before its turns
-- are saved), so the row cannot reference turns(id). Recreate without the FK.
DROP TABLE IF EXISTS recordings;
CREATE TABLE recordings (
  id           TEXT PRIMARY KEY,
  turn_id      TEXT NOT NULL,
  session_id   TEXT,
  r2_key       TEXT NOT NULL,
  duration_sec REAL NOT NULL DEFAULT 0,
  content_type TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordings_turn ON recordings(turn_id);
CREATE INDEX IF NOT EXISTS idx_recordings_session ON recordings(session_id);
CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at);
