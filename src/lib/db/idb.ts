// Tiny IndexedDB wrapper. The browser DB is only an offline cache/queue;
// D1 (via the Worker) is the source of truth.
import type { SessionPayload, Settings, StatsResponse } from '@shared/types';

const DB_NAME = 'synapse';
const DB_VERSION = 1;
const STORES = ['pendingSessions', 'cache'] as const;
type Store = (typeof STORES)[number];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export const idb = {
  // Pending (unsynced) sessions, keyed by session id.
  async queueSession(p: SessionPayload) {
    try {
      await tx('pendingSessions', 'readwrite', (s) => s.put(p, p.session.id));
    } catch {
      /* ignore */
    }
  },
  async pendingSessions(): Promise<SessionPayload[]> {
    try {
      return (await tx('pendingSessions', 'readonly', (s) => s.getAll())) as SessionPayload[];
    } catch {
      return [];
    }
  },
  async removePending(id: string) {
    try {
      await tx('pendingSessions', 'readwrite', (s) => s.delete(id));
    } catch {
      /* ignore */
    }
  },
  // Last known server state, for instant paint and offline viewing.
  async cacheStats(v: StatsResponse) {
    try {
      await tx('cache', 'readwrite', (s) => s.put(v, 'stats'));
    } catch {
      /* ignore */
    }
  },
  async cachedStats(): Promise<StatsResponse | null> {
    try {
      return ((await tx('cache', 'readonly', (s) => s.get('stats'))) as StatsResponse) ?? null;
    } catch {
      return null;
    }
  },
  async cacheSettings(v: Settings) {
    try {
      await tx('cache', 'readwrite', (s) => s.put(v, 'settings'));
    } catch {
      /* ignore */
    }
  },
  async cachedSettings(): Promise<Settings | null> {
    try {
      return ((await tx('cache', 'readonly', (s) => s.get('settings'))) as Settings) ?? null;
    } catch {
      return null;
    }
  },
};
