import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types';
import { api, getToken } from '@/lib/api/client';
import { idb } from '@/lib/db/idb';

const LS_KEY = 'synapse.settings';
const THEME_KEY = 'synapse.theme';
export type Theme = 'dark' | 'light';

interface Ctx {
  settings: Settings;
  /** Update locally (instant) and push to D1 in the background. */
  update: (patch: Partial<Settings>) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  loaded: boolean;
}

const SettingsCtx = createContext<Ctx | null>(null);

function readLocal(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* ignore */
  }
  return 'dark';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readLocal);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [loaded, setLoaded] = useState(false);
  const pushTimer = useRef<number | null>(null);
  const pendingPatch = useRef<Partial<Settings>>({});

  // Pull server copy once (D1 is the source of truth across devices).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        setLoaded(true);
        return;
      }
      try {
        const s = await api.getSettings();
        if (cancelled) return;
        setSettings(s);
        localStorage.setItem(LS_KEY, JSON.stringify(s));
        void idb.cacheSettings(s);
      } catch {
        const cached = await idb.cachedSettings();
        if (cached && !cancelled) setSettings(cached);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.lang = settings.uiLang;
  }, [theme, settings.uiLang]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      void idb.cacheSettings(next);
      return next;
    });
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (pushTimer.current) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      const p = pendingPatch.current;
      pendingPatch.current = {};
      if (getToken() && Object.keys(p).length) void api.putSettings(p).catch(() => {});
    }, 600);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ settings, update, theme, setTheme, loaded }), [settings, update, theme, setTheme, loaded]);
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Ctx {
  const v = useContext(SettingsCtx);
  if (!v) throw new Error('useSettings outside SettingsProvider');
  return v;
}
