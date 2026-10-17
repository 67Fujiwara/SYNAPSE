import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import en from './en.json';
import ja from './ja.json';
import { useSettings } from '@/features/settings/SettingsProvider';
import type { UiLang } from '@shared/types';

type Dict = Record<string, string>;
const DICTS: Record<UiLang, Dict> = { en, ja };

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

const Ctx = createContext<{ t: TFn; lang: UiLang }>({ t: (k) => k, lang: 'en' });

export function I18nProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const lang = settings.uiLang;
  const t = useCallback<TFn>(
    (key, vars) => {
      let s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );
  const value = useMemo(() => ({ t, lang }), [t, lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}
