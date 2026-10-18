-- Phase 2: review term notes, attempt mode.
ALTER TABLE reviews ADD COLUMN term_notes TEXT;
ALTER TABLE shadow_attempts ADD COLUMN mode TEXT NOT NULL DEFAULT 'shadow';
CREATE INDEX IF NOT EXISTS idx_shadow_items_due ON shadow_items(due_at);
CREATE INDEX IF NOT EXISTS idx_shadow_attempts_item ON shadow_attempts(item_id, at);
