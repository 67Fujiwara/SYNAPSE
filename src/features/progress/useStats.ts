import { useCallback, useEffect, useState } from 'react';
import type { StatsResponse } from '@shared/types';
import { api, getToken } from '@/lib/api/client';
import { idb } from '@/lib/db/idb';
import { onSyncChange } from '@/lib/sync';

export function useStats(days = 7) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    if (!getToken()) {
      setError('token');
      return;
    }
    try {
      const s = await api.stats(days);
      setStats(s);
      setOffline(false);
      setError(null);
      if (days === 7) void idb.cacheStats(s);
    } catch (e) {
      const cached = await idb.cachedStats();
      if (cached) {
        setStats(cached);
        setOffline(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      onSyncChange((n) => {
        setPending(n);
        void load();
      }),
    [load],
  );

  useEffect(() => {
    void idb.pendingSessions().then((p) => setPending(p.length));
  }, []);

  return { stats, error, offline, pending, reload: load };
}
