import type { RecordingMeta } from '../../shared/types';

interface Row {
  id: string;
  turn_id: string;
  session_id: string | null;
  r2_key: string;
  duration_sec: number;
  content_type: string | null;
  created_at: string;
}

const toMeta = (r: Row): RecordingMeta => ({
  id: r.id,
  turnId: r.turn_id,
  sessionId: r.session_id ?? '',
  durationSec: r.duration_sec,
  contentType: r.content_type ?? 'audio/webm',
  createdAt: r.created_at,
});

export function recordingKey(sessionId: string, turnId: string, contentType: string): string {
  const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : contentType.includes('wav') ? 'wav' : 'webm';
  return `recordings/${sessionId}/${turnId}.${ext}`;
}

export async function putRecording(db: D1Database, bucket: R2Bucket, meta: Omit<RecordingMeta, 'id'> & { id: string }, key: string, body: ArrayBuffer) {
  await bucket.put(key, body, { httpMetadata: { contentType: meta.contentType } });
  await db
    .prepare('INSERT OR REPLACE INTO recordings (id, turn_id, session_id, r2_key, duration_sec, content_type, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(meta.id, meta.turnId, meta.sessionId, key, meta.durationSec, meta.contentType, meta.createdAt)
    .run();
}

export async function listRecordings(db: D1Database, sessionId: string): Promise<RecordingMeta[]> {
  const { results } = await db.prepare('SELECT * FROM recordings WHERE session_id = ? ORDER BY created_at').bind(sessionId).all<Row>();
  return results.map(toMeta);
}

export async function findRecording(db: D1Database, turnId: string): Promise<(RecordingMeta & { key: string }) | null> {
  const r = await db.prepare('SELECT * FROM recordings WHERE turn_id = ?').bind(turnId).first<Row>();
  return r ? { ...toMeta(r), key: r.r2_key } : null;
}

/** Delete recordings older than `days`. Returns how many were removed. */
export async function purgeRecordings(db: D1Database, bucket: R2Bucket, days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { results } = await db.prepare('SELECT id, r2_key FROM recordings WHERE created_at < ? LIMIT 500').bind(cutoff).all<{ id: string; r2_key: string }>();
  if (results.length === 0) return 0;
  await bucket.delete(results.map((r) => r.r2_key));
  await db.batch(results.map((r) => db.prepare('DELETE FROM recordings WHERE id = ?').bind(r.id)));
  return results.length;
}
