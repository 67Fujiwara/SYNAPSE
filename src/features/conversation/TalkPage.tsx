import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Briefcase, Coffee, MessageSquare, Mic, MicOff, Send, Wrench, X } from 'lucide-react';
import type { Mode, Review, SessionPayload } from '@shared/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useT } from '@/i18n';
import { useSettings } from '@/features/settings/SettingsProvider';
import { api, getToken } from '@/lib/api/client';
import { persistSession } from '@/lib/sync';
import { useConversation } from './useConversation';
import { Transcript } from './Transcript';
import { Waveform } from './Waveform';
import { SummaryCard } from './SummaryCard';
import { WordPopover } from './WordPopover';
import { cx, fmtMinutes } from '@/lib/util';
import { isIOS } from '@/lib/speech/platform';

const MODES: { id: Mode; Icon: typeof Coffee }[] = [
  { id: 'daily', Icon: Coffee },
  { id: 'business', Icon: Briefcase },
  { id: 'mywork', Icon: Wrench },
  { id: 'free', Icon: MessageSquare },
];

const OPENERS: Record<Mode, string> = {
  daily: "Hey! Good to see you. So, how's your week going so far?",
  business: "Hey, got a minute? I wanted to go over a couple of things on the control panel. Where do you want to start?",
  free: "Hey! What's on your mind today?",
  mywork: '',
};

function openingFromScenario(s: string): string {
  const m = s.match(/Opening line:\s*(.+)/i);
  return m ? m[1].trim().replace(/^["“]|["”]$/g, '') : 'Hey, thanks for jumping on. Can you walk me through where things stand?';
}

export function TalkPage() {
  const { t } = useT();
  const { settings } = useSettings();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>((params.get('mode') as Mode) || 'daily');
  const [desc, setDesc] = useState('');
  const [scenario, setScenario] = useState('');
  const [building, setBuilding] = useState(false);
  const [buildErr, setBuildErr] = useState<string | null>(null);
  const [result, setResult] = useState<SessionPayload | null>(null);
  const [saved, setSaved] = useState<'synced' | 'queued' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [word, setWord] = useState<{ word: string; sentence: string } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewState, setReviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [reviewErr, setReviewErr] = useState<string | null>(null);

  // 'auto' = always-on mic on desktop, push-to-talk on iOS (Safari can't restart
  // recognition without a gesture). The server engine is push-to-talk by nature.
  const micMode: 'continuous' | 'push' =
    settings.sttEngine === 'server' ? 'push' : settings.micMode === 'auto' ? (isIOS() ? 'push' : 'continuous') : settings.micMode;

  const conv = useConversation({
    mode,
    micMode,
    engine: settings.sttEngine,
    immersion: settings.immersion,
    scenario: mode === 'mywork' ? scenario : undefined,
    model: settings.chatModel,
    voice: settings.voice,
    rate: settings.rate,
    silenceSec: settings.silenceSec,
    manualSend: settings.manualSend,
  });
  const { state } = conv;
  const live = state.phase !== 'idle' && state.phase !== 'ended';

  // Elapsed timer
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (!live) return;
    startRef.current = Date.now();
    const id = window.setInterval(() => setElapsed((Date.now() - (startRef.current ?? Date.now())) / 1000), 1000);
    return () => window.clearInterval(id);
  }, [live]);

  const buildScenario = async () => {
    setBuilding(true);
    setBuildErr(null);
    try {
      const r = await api.scenario(desc, settings.chatModel);
      setScenario(r.scenario);
    } catch (e) {
      setBuildErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  };

  const begin = () => {
    setResult(null);
    setSaved(null);
    const opening = mode === 'mywork' ? openingFromScenario(scenario) : OPENERS[mode];
    conv.unlockAudio(); // inside the tap: required on iOS before any later speech
    void conv.start(opening);
  };

  const finish = async () => {
    const payload = conv.end();
    if (!payload) return;
    setWord(null);
    setResult(payload);
    setReview(null);
    setReviewErr(null);
    const hasUser = payload.turns.some((x) => x.role === 'user');
    if (!hasUser) {
      setSaved('synced'); // nothing to save
      return;
    }
    const status = await persistSession(payload);
    setSaved(status);
    // Phase 2: review with the accurate model once the session is on the server.
    if (status === 'synced') {
      setReviewState('loading');
      try {
        setReview(await api.review(payload.session.id, payload.turns.map((x) => ({ role: x.role, text: x.text })), settings.reviewModel));
        setReviewState('idle');
      } catch (e) {
        setReviewState('error');
        setReviewErr(e instanceof Error ? e.message : String(e));
      }
    }
  };

  // ---- Summary ----------------------------------------------------------------
  if (result) {
    return <SummaryCard payload={result} saved={saved} onAgain={() => setResult(null)} review={review} reviewState={reviewState} reviewErr={reviewErr} />;
  }

  // ---- Mode picker --------------------------------------------------------------
  if (!live) {
    const canStart = Boolean(getToken()) && conv.supported && (mode !== 'mywork' || scenario.trim());
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold">{t('talk.title')}</h1>
          <Link to="/" className="text-ink-3 hover:text-ink" aria-label={t('common.close')}>
            <X />
          </Link>
        </div>
        {!conv.supported && <Card className="mb-4 border-warn/40 text-sm text-warn">{t('talk.unsupported')}</Card>}
        {!getToken() && (
          <Card className="mb-4 flex items-center justify-between border-accent/40 text-sm">
            <span className="text-ink-2">{t('talk.noToken')}</span>
            <Link to="/settings">
              <Button size="sm">{t('nav.settings')}</Button>
            </Link>
          </Card>
        )}
        <h2 className="mb-3 text-sm uppercase tracking-wide text-ink-3">{t('talk.pick')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map(({ id, Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={cx(
                'card flex items-center gap-4 p-5 text-left transition',
                mode === id ? 'border-accent shadow-glow' : 'hover:border-ink-3/60',
              )}
            >
              <span className={cx('grid h-11 w-11 place-items-center rounded-xl', mode === id ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-ink-2')}>
                <Icon size={20} />
              </span>
              <span>
                <span className="block font-display text-lg font-semibold">{t(`talk.mode.${id}`)}</span>
                <span className="block text-xs text-ink-2">{t(`talk.mode.${id}.sub`)}</span>
              </span>
            </button>
          ))}
        </div>

        {mode === 'mywork' && (
          <Card className="mt-4 flex flex-col gap-3">
            <label className="text-sm font-medium">{t('talk.mywork.label')}</label>
            <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('talk.mywork.placeholder')} />
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" disabled={!desc.trim() || building} onClick={buildScenario}>
                {building ? t('talk.mywork.generating') : t('talk.mywork.generate')}
              </Button>
              {buildErr && <span className="text-xs text-danger">{buildErr}</span>}
            </div>
            {scenario && <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm text-ink-2">{scenario}</pre>}
          </Card>
        )}

        <div className="mt-8 flex justify-center">
          <Button size="lg" disabled={!canStart} onClick={begin} className="min-w-[220px]">
            <Mic size={18} /> {t('talk.start')}
          </Button>
        </div>
      </div>
    );
  }

  // ---- Live conversation (immersive) -------------------------------------------
  const phaseLabel =
    state.phase === 'ready'
      ? t('talk.ready')
      : state.phase === 'listening'
        ? state.transcribing
          ? t('talk.transcribing')
          : t('talk.listening')
        : state.phase === 'thinking'
          ? t('talk.thinking')
          : state.phase === 'speaking'
            ? t('talk.speaking')
            : t('talk.paused');
  const push = micMode === 'push';
  const errorText = state.error === 'mic-denied' ? t('talk.mic.denied') : state.error;
  const canInterrupt = state.phase === 'speaking' || state.phase === 'thinking';

  return (
    <div className="flex h-[100dvh] flex-col" onClick={canInterrupt ? conv.interrupt : undefined}>
      <div className="flex items-center justify-between px-4 py-3 text-xs text-ink-3">
        <span className="uppercase tracking-wider">{t(`talk.mode.${mode}`)}</span>
        <span className="tabular-nums">
          {t('talk.elapsed')} {fmtMinutes(elapsed)} · {state.words} {t('talk.words')}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void finish();
          }}
          className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-surface-2"
        >
          <X size={14} /> {t('talk.end')}
        </button>
      </div>

      <Transcript
        turns={state.turns}
        draft={state.draft}
        interim={state.interim}
        placeholder={t('talk.sayHi')}
        jaMode={settings.immersion === 'low' ? 'always' : settings.immersion === 'medium' ? 'tap' : 'off'}
        onToggleJa={conv.toggleJa}
        jaLabel={t('talk.ja')}
        onWord={(w, sentence) => setWord({ word: w, sentence })}
      />
      {word && <WordPopover word={word.word} sentence={word.sentence} onClose={() => setWord(null)} />}

      {errorText && <div className="mx-auto mb-2 max-w-3xl px-5 text-center text-sm text-danger">{errorText}</div>}

      <div className="mx-auto w-full max-w-3xl px-5 pb-6" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
        {push && (
          <div className="mb-4 flex flex-col items-center gap-2">
            <button
              type="button"
              aria-label={state.phase === 'listening' ? t('talk.tapToSend') : t('talk.ready')}
              disabled={state.phase !== 'ready' && state.phase !== 'listening'}
              onClick={(e) => {
                e.stopPropagation();
                conv.tapMic();
              }}
              className={cx(
                'relative grid h-20 w-20 place-items-center rounded-full border-2 transition disabled:opacity-40',
                state.phase === 'listening'
                  ? 'border-accent bg-accent/20 text-accent shadow-glow pulse-ring'
                  : 'border-line bg-surface-2 text-ink hover:border-accent/60',
              )}
            >
              <Mic size={30} />
            </button>
            <span className="text-xs text-ink-3">{state.phase === 'listening' ? t('talk.tapToSend') : t('talk.pushHint')}</span>
          </div>
        )}
        <Waveform active={state.phase === 'listening' && state.listening} />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <span className={cx('relative inline-block h-2.5 w-2.5 rounded-full', state.phase === 'listening' ? 'bg-accent pulse-ring' : state.phase === 'speaking' ? 'bg-lime' : 'bg-ink-3')} />
            {phaseLabel}
            {canInterrupt && <span className="text-ink-3">· {t('talk.tapToInterrupt')}</span>}
          </div>
          <div className="flex items-center gap-2">
            {state.phase === 'listening' ? <Mic size={16} className="text-accent" /> : <MicOff size={16} className="text-ink-3" />}
            <Button
              size="sm"
              variant="outline"
              disabled={!state.draft || state.phase !== 'listening'}
              onClick={(e) => {
                e.stopPropagation();
                conv.send();
              }}
            >
              <Send size={14} /> {t('talk.send')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
