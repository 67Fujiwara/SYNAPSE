import { api } from './api/client';
import { idb } from './db/idb';
import type { SessionPayload } from '@shared/types';

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();
let syncing = false;

export function onSyncChange(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function notify() {
  const n = (await idb.pendingSessions()).length;
  listeners.forEach((l) => l(n));
}

/** Save a finished session: try the server; on failure keep it queued locally. */
export async function persistSession(payload: SessionPayload): Promise<'synced' | 'queued'> {
  await idb.queueSession(payload); // queue first so a crash mid-request loses nothing
  try {
    await api.saveSession(payload);
    await idb.removePending(payload.session.id);
    await notify();
    return 'synced';
  } catch {
    await notify();
    return 'queued';
  }
}

/** Push any queued sessions to D1. Safe to call often (idempotent server side). */
export async function flushPending(): Promise<number> {
  if (syncing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0;
  syncing = true;
  let flushed = 0;
  try {
    for (const p of await idb.pendingSessions()) {
      try {
        await api.saveSession(p);
        await idb.removePending(p.session.id);
        flushed += 1;
      } catch {
        break; // still offline or server down; try again later
      }
    }
  } finally {
    syncing = false;
    await notify();
  }
  return flushed;
}

export function startSyncLoop() {
  void flushPending();
  window.addEventListener('online', () => void flushPending());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushPending();
  });
  const id = window.setInterval(() => void flushPending(), 60_000);
  return () => window.clearInterval(id);
}
