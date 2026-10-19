import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Mic, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { ShadowItem, ShadowMode } from '@shared/types';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';
import { useSettings } from '@/features/settings/SettingsProvider';
import { WebSpeechRecognizer } from '@/lib/speech/recognition';
import { ServerRecognizer } from '@/lib/speech/server-recognizer';
import type { Recognizer } from '@/lib/speech/types';
import { align, timingBonus, type AlignResult } from '@/lib/align';
import { wordCount } from '@/lib/metrics';
import { cx } from '@/lib/util';
import { useKaraoke } from './karaoke';

const MODES: ShadowMode[] = ['listen', 'overlap', 'shadow', 'recall'];
const SPEEDS = [0.7, 0.85, 1.0, 1.15];
const NATIVE_WPM = 150;

interface Result {
  align: AlignResult;
  score: number;
  wpm: number;
  bonus: number;
}

export function Practice({
  item,
  onAttempt,
  onNext,
  onDelete,
}: {
  item: ShadowItem;
  onAttempt: (a: { itemId: string; score: number; wpm: number; speed: number; mode: ShadowMode; durationSec: number }) => Promise<ShadowItem>;
  onNext: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const { settings } = useSettings();
  const [mode, setMode] = useState<ShadowMode>('listen');
  const [speed, setSpeed] = useState(1.0);
  const [listening, setListening] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [heard, setHeard] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState<ShadowItem | null>(null);
  const [showJa, setShowJa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const k = useKaraoke();

  const words = useMemo(() => item.text.split(/\s+/).filter(Boolean), [item.text]);
  const refSec = useRef(0);
  const speakStart = useRef(0);
  const heardRef = useRef('');
  const stopTimer = useRef<number | null>(null);

  const recognizer: Recognizer = useMemo(
    () => (settings.sttEngine === 'server' ? new ServerRecognizer() : new WebSpeechRecognizer('en-US')),
    [settings.sttEngine],
  );

  // Reset when the sentence changes.
  useEffect(() => {
    setResult(null);
    setHeard('');
    setSaved(null);
    setError(null);
    setLeak(false);
    heardRef.current = '';
    k.stop();
    recognizer.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const playingRef = useRef(false);
  const [leak, setLeak] = useState(false);

  const finishAttempt = useCallback(
    async (text: string) => {
      // Overlap / Shadow: the reference is still playing — the learner can't be done yet.
      if (playingRef.current) {
        if (stopTimer.current) window.clearTimeout(stopTimer.current);
        stopTimer.current = window.setTimeout(() => void finishAttempt(heardRef.current), 700);
        return;
      }
      recognizer.stop();
      setListening(false);
      if (!text.trim()) {
        setScoring(false);
        return;
      }
      setScoring(true);
      const sec = Math.max(0.5, (Date.now() - speakStart.current) / 1000);
      const a = align(item.text, text);
      // Speaker leak: the mic heard the reference too (roughly the sentence twice over).
      const heardWords = wordCount(text);
      if (heardWords >= words.length * 1.6 && a.extras.length >= Math.ceil(words.length * 0.5)) {
        setLeak(true);
        setScoring(false);
        return;
      }
      const bonus = timingBonus(sec, refSec.current || (words.length / NATIVE_WPM) * 60);
      const score = Math.min(100, a.score + bonus);
      const wpm = Math.round((wordCount(text) / sec) * 60);
      const r = { align: a, score, wpm, bonus };
      setResult(r);
      try {
        setSaved(await onAttempt({ itemId: item.id, score, wpm, speed, mode, durationSec: Math.round(sec * 10) / 10 }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setScoring(false);
      }
    },
    [item.id, item.text, mode, onAttempt, recognizer, speed, words.length],
  );

  useEffect(() => {
    recognizer.onResult(({ final, interim }) => {
      if (final) {
        heardRef.current = (heardRef.current + ' ' + final).trim();
        setHeard(heardRef.current);
        // Browser engine: a final result after a pause means they're done.
        if (stopTimer.current) window.clearTimeout(stopTimer.current);
        stopTimer.current = window.setTimeout(() => void finishAttempt(heardRef.current), Math.max(900, settings.silenceSec * 1000));
      } else if (interim) {
        setHeard((heardRef.current + ' ' + interim).trim());
        if (stopTimer.current) window.clearTimeout(stopTimer.current);
      }
    });
    recognizer.onError((code) => {
      setListening(false);
      setError(code === 'not-allowed' ? t('talk.mic.denied') : code);
    });
    recognizer.onStateChange((on) => setListening(on));
    return () => {
      recognizer.stop();
      if (stopTimer.current) window.clearTimeout(stopTimer.current);
    };
  }, [recognizer, finishAttempt, t, settings.silenceSec]);

  const play = async () => {
    setResult(null);
    const sec = await k.speak(item.text, speed, settings.voice);
    if (sec) refSec.current = sec;
  };

  /** Speak: Listen = just play. Overlap/Shadow = play and record together. Recall = record only. */
  const speak = async () => {
    setError(null);
    setResult(null);
    setLeak(false);
    heardRef.current = '';
    setHeard('');
    speakStart.current = Date.now();
    recognizer.setKeepAlive(false);
    recognizer.start();
    if (mode === 'overlap' || mode === 'shadow') {
      playingRef.current = true;
      const sec = await k.speak(item.text, speed, settings.voice);
      playingRef.current = false;
      if (sec) refSec.current = sec;
    }
    // Hard stop so a silent attempt doesn't hang.
    const limit = Math.max(6000, (words.length / 60) * 1000 * 60 * 2);
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    stopTimer.current = window.setTimeout(() => void finishAttempt(heardRef.current), limit);
  };

  const stopSpeaking = () => {
    if (settings.sttEngine === 'server') {
      setScoring(true);
      recognizer.stop(); // -> onResult -> finishAttempt
    } else void finishAttempt(heardRef.current);
  };

  const hidden = mode === 'recall' && !result;
  const targetWpm = Math.round(NATIVE_WPM * speed);

  return (
    <div className="flex flex-col gap-5">
      {/* Mode tabs */}
      <div className="grid grid-cols-4 gap-1 rounded-xl border border-line p-1">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setResult(null);
            }}
            className={cx('rounded-lg px-2 py-2 text-sm transition', mode === m ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink')}
            title={t(`shadow.mode.${m}.sub`)}
          >
            {t(`shadow.mode.${m}`)}
          </button>
        ))}
      </div>
      <p className="-mt-3 text-center text-xs text-ink-3">
        {t(`shadow.mode.${mode}.sub`)}
        {(mode === 'overlap' || mode === 'shadow') && <span className="ml-2 text-warn">{t('shadow.headphones')}</span>}
      </p>

      {/* Sentence (karaoke) */}
      <div
        className="card min-h-[120px] select-none px-6 py-8 text-center"
        onPointerDown={() => item.jaText && setShowJa(true)}
        onPointerUp={() => setShowJa(false)}
        onPointerLeave={() => setShowJa(false)}
      >
        {hidden ? (
          <p className="text-ink-3">{t('shadow.hidden')}</p>
        ) : (
          <p className="transcript-text font-medium leading-relaxed">
            {words.map((w, i) => {
              const mark = result?.align.words[i]?.mark;
              return (
                <span
                  key={i}
                  className={cx(
                    'rounded px-0.5 transition-colors',
                    k.wordIndex === i && 'bg-accent/25 text-accent',
                    mark === 'match' && 'text-lime',
                    mark === 'near' && 'text-warn',
                    mark === 'missing' && 'text-danger line-through decoration-danger/60',
                  )}
                >
                  {w}{' '}
                </span>
              );
            })}
          </p>
        )}
        {item.jaText && (
          <p className={cx('mt-3 text-sm text-ink-2 transition-opacity', showJa ? 'opacity-100' : 'opacity-0')}>{item.jaText}</p>
        )}
        {item.jaText && !showJa && <p className="mt-1 text-[11px] text-ink-3">{t('shadow.holdJa')}</p>}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-line p-0.5 text-xs">
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={cx('rounded-md px-2 py-1 tabular-nums', speed === s ? 'bg-surface-2 text-ink' : 'text-ink-2')}>
              {s.toFixed(2).replace(/0$/, '')}x
            </button>
          ))}
        </div>
        {k.speaking ? (
          <Button variant="outline" onClick={k.stop}>
            <Pause size={16} /> {t('shadow.stop')}
          </Button>
        ) : (
          <Button variant="outline" onClick={play} disabled={listening}>
            <Play size={16} /> {t('shadow.play')}
          </Button>
        )}
        {mode !== 'listen' &&
          (listening ? (
            <Button onClick={stopSpeaking} className="pulse-ring relative">
              <Mic size={16} /> {t('shadow.listening')}
            </Button>
          ) : (
            <Button onClick={speak} disabled={scoring || !recognizer.supported}>
              <Mic size={16} /> {scoring ? t('shadow.scoring') : t('shadow.speak')}
            </Button>
          ))}
      </div>

      {heard && !result && !leak && <p className="text-center text-sm text-ink-2">{heard}</p>}
      {leak && <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-center text-sm text-warn">{t('shadow.leak')}</p>}
      {error && <p className="text-center text-sm text-danger">{error}</p>}

      {/* Result */}
      {result && (
        <div className="card flex flex-col gap-3 p-5">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-3">{t('shadow.score')}</div>
              <div className={cx('font-display text-3xl font-semibold tabular-nums', result.score >= 70 ? 'text-lime' : 'text-warn')}>
                {result.score}%
              </div>
              {result.bonus > 0 && <div className="text-[11px] text-ink-3">+{result.bonus} rhythm</div>}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-3">{t('shadow.yourWpm')}</div>
              <div className="font-display text-3xl font-semibold tabular-nums">{result.wpm}</div>
              <div className="text-[11px] text-ink-3">
                {t('shadow.targetWpm')} {targetWpm}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-3">{t('shadow.streak')}</div>
              <div className="font-display text-3xl font-semibold tabular-nums">{saved?.masteredCount ?? item.masteredCount}</div>
            </div>
          </div>
          <p className="text-center text-sm text-ink-2">{t('shadow.legend')}</p>
          {result.align.extras.length > 0 && (
            <p className="text-center text-xs text-ink-3">
              {t('shadow.extras')}: {result.align.extras.join(', ')}
            </p>
          )}
          <p className="text-center text-sm">
            {result.score >= 70 ? t('shadow.pass', { days: saved?.intervalDays ?? 1 }) : t('shadow.fail')}
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => setResult(null)}>
              <RotateCcw size={16} /> {t('shadow.again')}
            </Button>
            <Button onClick={onNext}>
              {t('shadow.next')} <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-ink-3">
        <span>
          {t('shadow.best')} {Math.round((saved ?? item).bestScore)}% · {(saved ?? item).attempts}×
        </span>
        <button onClick={onDelete} className="flex items-center gap-1 hover:text-danger">
          <Trash2 size={12} /> {t('shadow.delete')}
        </button>
      </div>
    </div>
  );
}
