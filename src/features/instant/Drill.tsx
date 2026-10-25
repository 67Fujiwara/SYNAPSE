import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Clock, Mic, SkipForward, Volume2, X } from 'lucide-react';
import type { InstantItem } from '@shared/types';
import { INSTANT_MASTER_COUNT, type LevelSpec } from '@shared/instant';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';
import { useSettings } from '@/features/settings/SettingsProvider';
import { WebSpeechRecognizer } from '@/lib/speech/recognition';
import { ServerRecognizer } from '@/lib/speech/server-recognizer';
import { makeSynthesizer } from '@/lib/speech/factory';
import type { Recognizer, Synthesizer } from '@/lib/speech/types';
import { scoreAnswer, type ScoreResult } from '@/lib/instant/score';
import { countRepeats } from '@/lib/instant/repeat';
import { cx } from '@/lib/util';
import type { AttemptInput } from './useInstantDeck';

type Phase = 'cue' | 'speaking' | 'result' | 'done';
/** What the mic is doing right now (shown under the cue and in the repeat box). */
type MicStatus = 'idle' | 'speaking' | 'transcribing';
const REPEAT_TARGET = 3;
/** Grace given back when a noise burst ate the clock. */
const NOISE_GRACE_SEC = 1.5;

export interface RoundEntry {
  item: InstantItem;
  score: number;
  latencySec: number;
  passed: boolean;
  timedOut: boolean;
  masteredCount: number;
}

interface RepeatEntry {
  text: string;
  score: number;
  count: number;
}

export function Drill({
  items,
  spec,
  extraSec,
  onAttempt,
  onExit,
}: {
  items: InstantItem[];
  spec: LevelSpec;
  /** Extra seconds added to the level's limit ("relaxed" switch). */
  extraSec: number;
  onAttempt: (a: AttemptInput) => Promise<{ item: InstantItem; bonusXp: number }>;
  onExit: () => void;
}) {
  const { t } = useT();
  const { settings } = useSettings();
  const limitSec = spec.limitSec + extraSec;
  const server = settings.sttEngine === 'server';

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('cue');
  const [mic, setMic] = useState<MicStatus>('idle');
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [latency, setLatency] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [repeats, setRepeats] = useState(0);
  const [repeatLog, setRepeatLog] = useState<RepeatEntry[]>([]);
  const [remaining, setRemaining] = useState(limitSec);
  const [listening, setListening] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<RoundEntry[]>([]);
  const [xp, setXp] = useState(0);

  const item = items[idx];
  const phaseRef = useRef<Phase>('cue');
  const itemRef = useRef(item);
  const t0 = useRef(0); // cue shown (performance.now)
  const cueAt = useRef(0); // cue shown (Date.now) — clips that began earlier belong to the previous screen
  const deadline = useRef(0); // performance.now() when the clock runs out
  const speechAt = useRef(0);
  const heardRef = useRef('');
  const finishTimer = useRef<number | null>(null);
  const limitTimer = useRef<number | null>(null);
  const noiseTimer = useRef<number | null>(null);
  const tick = useRef<number | null>(null);
  const playingRef = useRef(false);
  const repeatsRef = useRef(0);
  const logRef = useRef<RoundEntry[]>([]);

  const recognizer: Recognizer = useMemo(() => {
    if (!server) return new WebSpeechRecognizer('en-US');
    const r = new ServerRecognizer(Math.round(Math.max(0.8, settings.silenceSec) * 1000));
    // Stricter than the conversation: a drill room is quiet and a false start costs the clock.
    r.setVad({ minThreshold: 0.03, startFrames: 6 });
    return r;
  }, [server, settings.silenceSec]);
  const synth: Synthesizer = useMemo(() => makeSynthesizer(settings.ttsEngine, settings.serverVoice), [settings.ttsEngine, settings.serverVoice]);

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const clearTimer = (ref: { current: number | null }, interval = false) => {
    if (ref.current !== null) (interval ? window.clearInterval : window.clearTimeout)(ref.current);
    ref.current = null;
  };
  const clearTimers = () => {
    clearTimer(finishTimer);
    clearTimer(limitTimer);
    clearTimer(noiseTimer);
    clearTimer(tick, true);
  };

  /** Mute the mic while the model answer plays so the playback is never transcribed. */
  const playAnswer = useCallback(
    async (text: string) => {
      playingRef.current = true;
      setPlaying(true);
      recognizer.setMuted(true);
      try {
        await synth.speak(text, { rate: settings.rate, voice: settings.voice });
      } finally {
        recognizer.setMuted(false);
        playingRef.current = false;
        setPlaying(false);
      }
    },
    [recognizer, synth, settings.rate, settings.voice],
  );

  /** Score what was heard (or a timeout), save it, and read the model answer once. */
  const finalize = useCallback(
    async (text: string, isTimeout: boolean) => {
      if (phaseRef.current !== 'cue' && phaseRef.current !== 'speaking') return;
      clearTimers();
      setMic('idle');
      const cur = itemRef.current;
      const lat = speechAt.current ? (speechAt.current - t0.current) / 1000 : limitSec;
      const r = scoreAnswer(cur, text);
      const passed = !isTimeout && r.passed;
      setResult(r);
      setLatency(Math.round(lat * 10) / 10);
      setTimedOut(isTimeout);
      setHeard(text);
      setRepeatLog([]);
      repeatsRef.current = 0;
      setRepeats(0);
      setPhaseBoth('result');
      let mastered = cur.masteredCount;
      try {
        const res = await onAttempt({ itemId: cur.id, score: isTimeout ? 0 : r.score, latencySec: Math.round(lat * 100) / 100, heard: text, passed, timedOut: isTimeout });
        mastered = res.item.masteredCount;
        if (res.bonusXp) setXp((x) => x + res.bonusXp);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      const entry: RoundEntry = { item: cur, score: isTimeout ? 0 : r.score, latencySec: lat, passed, timedOut: isTimeout, masteredCount: mastered };
      logRef.current = [...logRef.current, entry];
      setLog(logRef.current);
      void playAnswer(cur.answer);
    },
    [limitSec, onAttempt, playAnswer],
  );

  /** Start (or resume) the clock with `sec` seconds left. */
  const armClock = useCallback(
    (sec: number) => {
      clearTimer(limitTimer);
      clearTimer(tick, true);
      deadline.current = performance.now() + sec * 1000;
      setRemaining(sec);
      tick.current = window.setInterval(() => setRemaining(Math.max(0, (deadline.current - performance.now()) / 1000)), 100);
      limitTimer.current = window.setTimeout(() => void finalize(heardRef.current, true), sec * 1000);
    },
    [finalize],
  );

  /** A "speech start" that produced no words was noise: give the clock back. */
  const revertToCue = useCallback(() => {
    if (phaseRef.current !== 'speaking') return;
    clearTimer(noiseTimer);
    clearTimer(finishTimer);
    speechAt.current = 0;
    heardRef.current = '';
    setHeard('');
    setMic('idle');
    setPhaseBoth('cue');
    armClock(Math.max(NOISE_GRACE_SEC, (deadline.current - performance.now()) / 1000));
  }, [armClock]);

  /** Show the current cue and start the clock. */
  const showCue = useCallback(() => {
    clearTimers();
    heardRef.current = '';
    speechAt.current = 0;
    setHeard('');
    setResult(null);
    setTimedOut(false);
    setError(null);
    setMic('idle');
    setPhaseBoth('cue');
    t0.current = performance.now();
    cueAt.current = Date.now();
    armClock(limitSec);
    recognizer.start();
  }, [armClock, limitSec, recognizer]);

  const next = useCallback(() => {
    if (phaseRef.current !== 'result') return;
    synth.cancel();
    // Whatever is being said right now belongs to this screen, not the next cue.
    recognizer.discardClip();
    if (idx + 1 >= items.length) {
      clearTimers();
      recognizer.setKeepAlive(false);
      recognizer.stop();
      setPhaseBoth('done');
      return;
    }
    const n = idx + 1;
    itemRef.current = items[n];
    setIdx(n);
    showCue();
  }, [idx, items, recognizer, showCue, synth]);

  const skip = () => {
    if (phaseRef.current === 'cue' || phaseRef.current === 'speaking') void finalize(heardRef.current, true);
  };

  // Mount: wire the recognizer, start the first cue. Unmount: stop everything.
  useEffect(() => {
    recognizer.setKeepAlive(true);
    recognizer.onStateChange((on) => setListening(on));
    recognizer.onError((code) => setError(code === 'not-allowed' ? t('talk.mic.denied') : code));
    recognizer.onLevel?.((v) => setLevel(v));
    // The server VAD needs ~300 ms of sound before it calls speech; don't bill that to the learner.
    const vadLead = server ? 300 : 0;
    const markSpeechStart = () => {
      speechAt.current = Math.max(t0.current, performance.now() - vadLead);
      clearTimer(limitTimer);
      clearTimer(tick, true);
      setPhaseBoth('speaking');
    };
    recognizer.onSpeechStart(() => {
      if (phaseRef.current === 'cue') {
        markSpeechStart();
        // No words within this long -> it was noise (the browser engine answers fast; Whisper has to upload first).
        clearTimer(noiseTimer);
        noiseTimer.current = window.setTimeout(revertToCue, server ? 12_000 : 4_000);
      }
      if (phaseRef.current !== 'done') setMic('speaking');
    });
    recognizer.onSpeechEnd(() => {
      if (phaseRef.current === 'done') return;
      setMic(server ? 'transcribing' : 'idle');
      // Browser engine: a speech end with no words shortly after is noise. (The server engine
      // tells us through onClip below; its timer set at speech start is only a backstop.)
      if (phaseRef.current === 'speaking' && !server && noiseTimer.current === null) noiseTimer.current = window.setTimeout(revertToCue, 1_500);
    });
    if (recognizer instanceof ServerRecognizer) {
      // Every clip reports back, even when Whisper heard nothing: that is how a noise burst is told apart from speech.
      recognizer.onClip = (_blob, text) => {
        if (text.trim()) return;
        if (phaseRef.current === 'speaking') revertToCue();
        else if (phaseRef.current === 'result') setMic('idle');
      };
    }
    recognizer.onResult(({ final, interim, clipStartedAt }) => {
      const p = phaseRef.current;
      if (clipStartedAt && clipStartedAt < cueAt.current) return; // from the previous screen
      if (final || interim) setMic(final ? 'idle' : 'speaking');
      if (p === 'cue' || p === 'speaking') {
        if (!speechAt.current && (final || interim)) markSpeechStart();
        clearTimer(noiseTimer);
        if (final) {
          heardRef.current = (heardRef.current + ' ' + final).trim();
          setHeard(heardRef.current);
          clearTimer(finishTimer);
          // Server clips already end at silence; the browser engine needs a settle time.
          const wait = server ? 250 : Math.max(900, settings.silenceSec * 1000);
          finishTimer.current = window.setTimeout(() => void finalize(heardRef.current, false), wait);
        } else if (interim) {
          setHeard((heardRef.current + ' ' + interim).trim());
          clearTimer(finishTimer);
        }
      } else if (p === 'result') {
        if (playingRef.current) return; // our own playback (mic is muted, but be safe)
        if (!final) return;
        const { count, best } = countRepeats(itemRef.current.answer, final, REPEAT_TARGET - repeatsRef.current);
        setRepeatLog((l) => [...l, { text: final, score: best, count }]);
        if (count > 0) {
          repeatsRef.current = Math.min(REPEAT_TARGET, repeatsRef.current + count);
          setRepeats(repeatsRef.current);
        }
      }
    });
    itemRef.current = items[0];
    showCue();
    return () => {
      clearTimers();
      recognizer.setKeepAlive(false);
      recognizer.stop();
      synth.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recognizer]);

  // Three clean repeats -> move on by itself.
  useEffect(() => {
    if (repeats < REPEAT_TARGET || phase !== 'result') return;
    const id = window.setTimeout(next, 900);
    return () => window.clearTimeout(id);
  }, [repeats, phase, next]);

  // Keyboard: Space / Enter = next, Esc = skip.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === ' ' || e.key === 'Enter') && phaseRef.current === 'result') {
        e.preventDefault();
        next();
      } else if (e.key === 'Escape') skip();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next]);

  // ---- Summary -----------------------------------------------------------------------------
  if (phase === 'done') {
    const passed = log.filter((e) => e.passed);
    const avgLat = passed.length ? passed.reduce((a, e) => a + e.latencySec, 0) / passed.length : 0;
    const fast = passed.filter((e) => e.latencySec <= spec.fastSec).length;
    return (
      <div className="flex flex-col gap-5">
        <div className="card p-6 text-center">
          <div className="text-xs uppercase tracking-wide text-ink-3">{t('instant.summary')}</div>
          <div className="mt-2 grid grid-cols-3 gap-4">
            <div>
              <div className="font-display text-3xl font-semibold tabular-nums text-lime">
                {passed.length}
                <span className="text-base text-ink-3">/{log.length}</span>
              </div>
              <div className="text-xs text-ink-2">{t('instant.summary.passed')}</div>
            </div>
            <div>
              <div className="font-display text-3xl font-semibold tabular-nums">{passed.length ? `${avgLat.toFixed(1)}s` : '—'}</div>
              <div className="text-xs text-ink-2">{t('instant.summary.latency')}</div>
            </div>
            <div>
              <div className="font-display text-3xl font-semibold tabular-nums text-accent">{fast}</div>
              <div className="text-xs text-ink-2">{t('instant.summary.fast', { sec: spec.fastSec })}</div>
            </div>
          </div>
          {xp > 0 && <div className="mt-3 text-sm text-warn">+{xp} XP</div>}
        </div>
        <ul className="card divide-y divide-line/70 p-0">
          {log.map((e, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <span className={cx('mt-0.5 shrink-0', e.passed ? 'text-lime' : 'text-danger')}>{e.passed ? <Check size={16} /> : <X size={16} />}</span>
              <span className="flex-1">
                <span className="block text-ink-2">
                  {e.item.cue}
                  {e.item.transform ? ` → ${e.item.transform}` : ''}
                </span>
                <span className="block">{e.item.answer}</span>
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums text-ink-3">
                {e.timedOut ? t('instant.timeout') : `${e.score}% · ${e.latencySec.toFixed(1)}s`}
                {e.masteredCount >= INSTANT_MASTER_COUNT && <span className="ml-1 text-lime">★</span>}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex justify-center">
          <Button onClick={onExit}>{t('instant.backToLevels')}</Button>
        </div>
      </div>
    );
  }

  // ---- Drill --------------------------------------------------------------------------------
  const pct = Math.max(0, Math.min(100, (remaining / limitSec) * 100));
  const words = result ? result.ref.split(/\s+/).filter(Boolean) : [];
  const showModel = phase === 'result';

  const micLine = (
    <span className="flex items-center gap-2 text-sm">
      {mic === 'speaking' && (
        <span className="pulse-ring relative flex items-center gap-1.5 rounded-full px-3 py-1 text-accent">
          <Mic size={14} /> {t('instant.speaking')}
        </span>
      )}
      {mic === 'transcribing' && <span className="animate-pulse text-ink-2">{t('instant.transcribing')}</span>}
      {mic === 'idle' && phase === 'cue' && (
        <span className="flex items-center gap-1.5 tabular-nums text-ink-2">
          <Clock size={14} /> {remaining.toFixed(1)}s
        </span>
      )}
      <LevelBar level={level} active={listening && !playing} />
    </span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs text-ink-3">
        <span className="tabular-nums">
          {idx + 1} / {items.length} · Lv.{spec.level}
        </span>
        <span className={cx('flex items-center gap-1', listening ? 'text-accent' : '')}>
          <Mic size={12} /> {listening ? t('instant.micOn') : t('instant.micOff')}
        </span>
      </div>

      {/* Time bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cx('h-full transition-[width] duration-100', phase === 'cue' ? (pct < 35 ? 'bg-danger' : 'bg-accent') : 'bg-lime')}
          style={{ width: phase === 'cue' ? `${pct}%` : '100%' }}
        />
      </div>

      {/* Cue */}
      <div className="card px-6 py-8 text-center">
        <div className="text-[11px] uppercase tracking-wide text-ink-3">{t(`instant.cue.${item.cueKind}`)}</div>
        <p className="mt-2 font-display text-2xl font-medium leading-snug">{item.cue}</p>
        {item.transform && <p className="mt-2 text-lg text-accent">→ {item.transform}</p>}
        {!showModel && <div className="mt-4 flex items-center justify-center">{micLine}</div>}
        {/* What the mic heard, as it comes in (the browser engine shows words live; Whisper after each pause). */}
        {heard && !showModel && <p className="mt-3 text-lg text-ink" aria-live="polite">{heard}</p>}
      </div>

      {/* Model answer + score */}
      {showModel && result && (
        <div className="card flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <span className={cx('font-display text-2xl font-semibold tabular-nums', timedOut ? 'text-danger' : result.passed ? 'text-lime' : 'text-warn')}>
              {timedOut ? t('instant.timeout') : `${result.score}%`}
            </span>
            <span className="flex items-center gap-1 text-sm tabular-nums text-ink-2" title={t('instant.latency.help')}>
              <Clock size={14} /> {timedOut ? '—' : `${latency.toFixed(1)}s`}
              {!timedOut && latency <= spec.fastSec && result.passed && <span className="ml-1 text-xs text-accent">{t('instant.fast')}</span>}
            </span>
          </div>
          <p className="transcript-text font-medium leading-relaxed">
            {words.map((w, i) => {
              const mark = result.align.words[i]?.mark;
              return (
                <span key={i} className={cx('rounded px-0.5', mark === 'match' && 'text-lime', mark === 'near' && 'text-warn', mark === 'missing' && 'text-ink-3')}>
                  {w}{' '}
                </span>
              );
            })}
          </p>
          {result.ref !== item.answer && (
            <p className="text-xs text-ink-3">
              {t('instant.model')}: {item.answer}
            </p>
          )}
          {heard && !timedOut && (
            <p className="text-sm text-ink-2">
              <span className="text-ink-3">{t('instant.youSaid')}:</span> {heard}
            </p>
          )}
          {item.keywords.length > 0 && (
            <p className="flex flex-wrap gap-1.5 text-xs">
              {item.keywords.map((k) => (
                <span key={k} className={cx('rounded-md px-1.5 py-0.5', result.keywordHits.includes(k) ? 'bg-lime/15 text-lime' : 'bg-surface-2 text-ink-3 line-through')}>
                  {k}
                </span>
              ))}
            </p>
          )}
          {!result.passed && item.hint && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">{item.hint}</p>}
          {item.alternatives.length > 0 && (
            <details className="text-xs text-ink-3">
              <summary className="cursor-pointer">{t('instant.alternatives')}</summary>
              <ul className="mt-1 list-disc pl-4">
                {item.alternatives.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}

          {/* Repeat x3: what the mic hears is listed with its match. */}
          <div className="flex flex-col gap-2 rounded-lg border border-line px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-2">{t('instant.repeat')}</span>
              <span className="flex items-center gap-1.5">
                {Array.from({ length: REPEAT_TARGET }).map((_, i) => (
                  <span key={i} className={cx('h-2.5 w-2.5 rounded-full', i < repeats ? 'bg-lime' : 'bg-surface-2')} />
                ))}
              </span>
            </div>
            <div className="flex min-h-[20px] items-center justify-between gap-2 text-xs text-ink-3">
              {playing ? <span>{t('instant.playing')}</span> : micLine}
            </div>
            {repeatLog.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {repeatLog.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={cx('mt-0.5 shrink-0', r.count > 0 ? 'text-lime' : 'text-warn')}>{r.count > 0 ? <Check size={14} /> : <X size={14} />}</span>
                    <span className="flex-1 text-ink">{r.text}</span>
                    <span className="shrink-0 tabular-nums text-ink-3">{r.score}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => void playAnswer(item.answer)} disabled={playing}>
              <Volume2 size={16} /> {t('instant.listen')}
            </Button>
            <Button onClick={next}>
              {idx + 1 >= items.length ? t('instant.finish') : t('instant.next')} <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-center text-sm text-danger">{error}</p>}

      <div className="flex items-center justify-between text-xs text-ink-3">
        <button onClick={onExit} className="hover:text-ink">
          {t('instant.quit')}
        </button>
        {phase !== 'result' && (
          <button onClick={skip} className="flex items-center gap-1 hover:text-ink">
            <SkipForward size={12} /> {t('instant.skip')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Tiny mic meter: fills past the midpoint when the sound is loud enough to count as speech. */
function LevelBar({ level, active }: { level: number; active: boolean }) {
  return (
    <span className="inline-flex h-1.5 w-16 items-stretch overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <span className={cx('rounded-full transition-[width] duration-75', level >= 0.5 ? 'bg-accent' : 'bg-ink-3/60')} style={{ width: active ? `${Math.round(level * 100)}%` : 0 }} />
    </span>
  );
}
