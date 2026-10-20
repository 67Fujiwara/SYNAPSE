import { useEffect, useRef, useState } from 'react';
import { Plus, Volume2, X } from 'lucide-react';
import type { WordInfo } from '@shared/types';
import { useT } from '@/i18n';
import { useSettings } from '@/features/settings/SettingsProvider';
import { api } from '@/lib/api/client';
import { makeSynthesizer } from '@/lib/speech/factory';

/** DeepL-style popover for one tapped word. Fetches from /api/word on open. */
export function WordPopover({ word, sentence, onClose }: { word: string; sentence: string; onClose: () => void }) {
  const { t } = useT();
  const { settings } = useSettings();
  const [info, setInfo] = useState<WordInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const synth = useRef(makeSynthesizer(settings.ttsEngine, settings.serverVoice));

  useEffect(() => {
    let alive = true;
    setInfo(null);
    setErr(null);
    api
      .word(word, sentence)
      .then((w) => alive && setInfo(w))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [word, sentence]);

  const say = (rate: number) => {
    synth.current.cancel();
    void synth.current.speak(info?.word ?? word, { rate, voice: settings.ttsEngine === 'server' ? settings.serverVoice : settings.voice });
  };

  const save = async () => {
    await api.addShadowItems([{ text: sentence, source: 'conversation' }]);
    setSaved(true);
  };

  return (
    <div
      className="card fixed inset-x-3 bottom-24 z-40 mx-auto max-w-md p-4 shadow-2xl sm:bottom-auto sm:left-auto sm:right-6 sm:top-20"
      role="dialog"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-2xl font-semibold">{info?.word ?? word}</div>
          <div className="text-sm text-ink-2">
            {info ? (
              <>
                <span className="font-mono">{info.ipa}</span> · <span>{info.pos}</span>
              </>
            ) : err ? (
              <span className="text-danger">{err}</span>
            ) : (
              t('word.loading')
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label={t('common.close')}>
          <X size={18} />
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => say(1)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent">
          <Volume2 size={14} /> {t('word.play')}
        </button>
        <button onClick={() => say(0.6)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent">
          <Volume2 size={14} /> {t('word.slow')}
        </button>
      </div>
      {info && (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <p>{info.definition}</p>
          {settings.immersion !== 'high' && <p className="text-ink-2">{info.ja}</p>}
          <p className="text-ink-2 italic">“{info.example}”</p>
        </div>
      )}
      <button
        onClick={() => void save()}
        disabled={saved}
        className="mt-3 inline-flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/25 disabled:opacity-60"
      >
        <Plus size={14} /> {saved ? t('word.saved') : t('word.save')}
      </button>
    </div>
  );
}
