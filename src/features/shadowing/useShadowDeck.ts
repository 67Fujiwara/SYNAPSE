import { useCallback, useEffect, useState } from 'react';
import type { NewShadowItem, ShadowItem, ShadowMode } from '@shared/types';
import { api, getToken } from '@/lib/api/client';

export function useShadowDeck() {
  const [items, setItems] = useState<ShadowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!getToken()) {
      setError('token');
      setLoading(false);
      return;
    }
    try {
      setItems(await api.shadowItems());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(async (newItems: NewShadowItem[]) => {
    const added = await api.addShadowItems(newItems);
    if (added.length) setItems((prev) => [...added, ...prev]);
    return added.length;
  }, []);

  const remove = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await api.deleteShadowItem(id);
  }, []);

  const attempt = useCallback(async (a: { itemId: string; score: number; wpm: number; speed: number; mode: ShadowMode; durationSec: number }) => {
    const updated = await api.shadowAttempt(a);
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    return updated;
  }, []);

  const now = Date.now();
  const due = items.filter((i) => !i.dueAt || Date.parse(i.dueAt) <= now);
  const later = items.filter((i) => i.dueAt && Date.parse(i.dueAt) > now);

  return { items, due, later, loading, error, reload: load, add, remove, attempt };
}
