import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';

const KEY = 'settings';

export async function getSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(KEY).first<{ value: string }>();
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function putSettings(db: D1Database, patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings(db);
  const next: Settings = { ...current, ...patch };
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(KEY, JSON.stringify(next))
    .run();
  return next;
}
