import { useCallback, useEffect, useState } from 'react';
import type { InstantItem, NewInstantItem } from '@shared/types';
import type { InstantLevel } from '@shared/instant';
import { api, getToken } from '@/lib/api/client';

export interface AttemptInput {
  itemId: string;
  score: number;
  latencySec: number;
  heard: string;
  passed: boolean;
  timedOut: boolean;
}

export function useInstantDeck() {
  const [items, setItems] = useState<InstantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!getToken()) {
      setError('token');
      setLoading(false);
      return;
    }
    try {
      setItems(await api.instantItems());
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

  const add = useCallback(async (newItems: NewInstantItem[]) => {
    const added = await api.addInstantItems(newItems);
    if (added.length) setItems((prev) => [...added, ...prev]);
    return added;
  }, []);

  const generate = useCallback(async (level: InstantLevel, focus?: string) => {
    const added = await api.generateInstant(level, 10, focus);
    if (added.length) setItems((prev) => [...added, ...prev]);
    return added.length;
  }, []);

  const remove = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await api.deleteInstantItem(id);
  }, []);

  const attempt = useCallback(async (a: AttemptInput) => {
    const res = await api.instantAttempt(a);
    setItems((prev) => prev.map((i) => (i.id === res.item.id ? res.item : i)));
    return res;
  }, []);

  const now = Date.now();
  const isDue = (i: InstantItem) => !i.dueAt || Date.parse(i.dueAt) <= now;
  const forLevel = (level: InstantLevel) => {
    const lv = items.filter((i) => i.level === level);
    return { all: lv, due: lv.filter(isDue), later: lv.filter((i) => !isDue(i)) };
  };

  return { items, loading, error, reload: load, add, generate, remove, attempt, forLevel };
}
