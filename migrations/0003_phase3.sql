-- Phase 3: mission bonus XP, shadow attempt duration, recordings metadata.
ALTER TABLE daily_stats ADD COLUMN bonus_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shadow_attempts ADD COLUMN duration_sec REAL NOT NULL DEFAULT 0;
ALTER TABLE recordings ADD COLUMN session_id TEXT;
ALTER TABLE recordings ADD COLUMN content_type TEXT;
CREATE INDEX IF NOT EXISTS idx_recordings_session ON recordings(session_id);
CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at);
