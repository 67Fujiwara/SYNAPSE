import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Sparkles, X, Zap } from 'lucide-react';
import type { InstantItem } from '@shared/types';
import { INSTANT_MASTER_COUNT, LEVELS, type InstantLevel, type LevelSpec } from '@shared/instant';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { useT } from '@/i18n';
import { starterItems } from '@/data/instantbank';
import { cx } from '@/lib/util';
import { useInstantDeck } from './useInstantDeck';
import { Drill, useDrillEngine } from './Drill';
import { useSettings } from '@/features/settings/SettingsProvider';
import { makeSynthesizer } from '@/lib/speech/factory';
import { primeMic } from '@/lib/speech/server-recognizer';
import { useServerStt } from '@/features/conversation/useServerStt';

const ROUND_SIZE = 10;
const RELAX_KEY = 'synapse.instant.relaxed';
const RELAX_SEC = 3;

function readRelaxed(): boolean {
  try {
    return localStorage.getItem(RELAX_KEY) === '1';
  } catch {
    return false;
  }
}

/** Build one round: due items first (never-seen before others), then not-yet-due to fill up. */
export function buildRound(due: InstantItem[], later: InstantItem[], size = ROUND_SIZE): InstantItem[] {
  const fresh = due.filter((i) => i.attempts === 0);
  const seen = due.filter((i) => i.attempts > 0);
  const soon = [...later].sort((a, b) => Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? ''));
  return [...fresh, ...seen, ...soon].slice(0, size);
}

export function InstantPage() {
  const { t } = useT();
  const { settings } = useSettings();
  const deck = useInstantDeck();
  const engine = useDrillEngine();
  const { tts: serverTts } = useServerStt();
  const ttsEngine = settings.ttsEngine === 'server' && serverTts ? 'server' : 'browser';
  const synth = useMemo(() => makeSynthesizer(ttsEngine, settings.serverVoice), [ttsEngine, settings.serverVoice]);
  const [round, setRound] = useState<{ spec: LevelSpec; items: InstantItem[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "gen:3" / "bank:1"
  const [note, setNote] = useState<string | null>(null);
  const [focus, setFocus] = useState('');
  const [relaxed, setRelaxedState] = useState(readRelaxed);
  const [open, setOpen] = useState<InstantLevel | null>(null);

  const setRelaxed = (v: boolean) => {
    setRelaxedState(v);
    try {
      localStorage.setItem(RELAX_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const counts = useMemo(() => LEVELS.map((l) => ({ spec: l, ...deck.forLevel(l.level) })), [deck]);

  /** Start a round; a level with no drills yet gets its starter set first. */
  const start = async (spec: LevelSpec) => {
    // Inside the tap, before any await: iOS only grants the mic and audio output from a user gesture.
    if (engine === 'server') primeMic();
    synth.unlock();
    let { due, later } = deck.forLevel(spec.level);
    if (due.length + later.length === 0) {
      setBusy(`bank:${spec.level}`);
      try {
        due = await deck.add(starterItems(spec.level));
        later = [];
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
        return;
      } finally {
        setBusy(null);
      }
    }
    const items = buildRound(due, later);
    if (items.length === 0) return;
    setRound({ spec, items });
  };

  const addStarter = async (level: InstantLevel) => {
    setBusy(`bank:${level}`);
    try {
      const n = (await deck.add(starterItems(level))).length;
      setNote(n ? t('instant.added', { n }) : t('instant.nothingNew'));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const generate = async (level: InstantLevel) => {
    setBusy(`gen:${level}`);
    setNote(t('instant.generating'));
    try {
      const n = await deck.generate(level, focus.trim() || undefined);
      setNote(n ? t('instant.added', { n }) : t('instant.nothingNew'));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (deck.error === 'token') {
    return (
      <Card className="flex items-center justify-between">
        <span className="text-sm text-ink-2">{t('talk.noToken')}</span>
        <Link to="/settings">
          <Button size="sm">{t('nav.settings')}</Button>
        </Link>
      </Card>
    );
  }

  if (round) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold">
            {t('instant.title')} <span className="text-base font-normal text-ink-2">· {t(`instant.level.${round.spec.level}`)}</span>
          </h1>
          <button onClick={() => setRound(null)} className="text-ink-3 hover:text-ink" aria-label={t('common.close')}>
            <X />
          </button>
        </div>
        <Drill key={round.items.map((i) => i.id).join(',')} items={round.items} spec={round.spec} extraSec={relaxed ? RELAX_SEC : 0} synth={synth} onAttempt={deck.attempt} onExit={() => setRound(null)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{t('instant.title')}</h1>
          <p className="mt-1 text-sm text-ink-2">{t('instant.intro')}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <Switch checked={relaxed} onChange={setRelaxed} label={t('instant.relaxed')} />
          {t('instant.relaxed', { sec: RELAX_SEC })}
        </label>
      </div>

      {deck.loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-surface-2/60" />
      ) : (
        <div className="grid gap-3">
          {counts.map(({ spec, all, due }) => {
            const mastered = all.filter((i) => i.masteredCount >= INSTANT_MASTER_COUNT).length;
            const pct = all.length ? Math.round((mastered / all.length) * 100) : 0;
            const isOpen = open === spec.level;
            return (
              <Card key={spec.level} className={cx('flex flex-col gap-3', isOpen && 'border-accent/50')}>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/15 font-display text-lg font-semibold text-accent">Lv{spec.level}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-display text-base font-semibold">{t(`instant.level.${spec.level}`)}</span>
                      <span className="text-xs text-ink-3">
                        {t(`instant.cue.${spec.cueKind}`)} · {t('instant.limit', { sec: spec.limitSec + (relaxed ? RELAX_SEC : 0) })} · {t('instant.fastIn', { sec: spec.fastSec })}
                      </span>
                    </div>
                    <p className="text-sm text-ink-2">{t(`instant.level.${spec.level}.sub`)}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs tabular-nums text-ink-3">
                      <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                        <span className="block h-full bg-lime" style={{ width: `${pct}%` }} />
                      </span>
                      {t('instant.counts', { due: due.length, total: all.length, mastered })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(isOpen ? null : spec.level)} aria-expanded={isOpen}>
                      <Plus size={14} /> {t('instant.more')}
                    </Button>
                    <Button size="sm" onClick={() => void start(spec)} disabled={busy !== null}>
                      <Zap size={14} /> {t('instant.start')}
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <div className="flex flex-col gap-2 border-t border-line/70 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => void addStarter(spec.level)} disabled={busy !== null}>
                        <Plus size={14} /> {t('instant.addStarter')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void generate(spec.level)} disabled={busy !== null}>
                        <Sparkles size={14} /> {busy === `gen:${spec.level}` ? t('instant.generating') : t('instant.generate')}
                      </Button>
                      <input
                        type="text"
                        value={focus}
                        onChange={(e) => setFocus(e.target.value)}
                        placeholder={t('instant.focus.placeholder')}
                        className="min-w-[200px] flex-1"
                        aria-label={t('instant.focus.placeholder')}
                      />
                    </div>
                    <p className="text-xs text-ink-3">{t('instant.generate.help')}</p>
                    {all.length > 0 && (
                      <ul className="max-h-48 divide-y divide-line/70 overflow-y-auto text-sm">
                        {all.map((i) => (
                          <li key={i.id} className="flex items-center justify-between gap-3 py-1.5">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-ink-2">
                                {i.cue}
                                {i.transform ? ` → ${i.transform}` : ''}
                              </span>
                              <span className="block truncate">{i.answer}</span>
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-ink-3">
                              {i.attempts > 0 ? `${i.bestScore}%${i.bestLatency !== null ? ` · ${i.bestLatency.toFixed(1)}s` : ''}` : '—'}
                              {i.masteredCount >= INSTANT_MASTER_COUNT && <span className="ml-1 text-lime">★</span>}
                            </span>
                            <button onClick={() => void deck.remove(i.id)} className="shrink-0 text-ink-3 hover:text-danger" aria-label={t('instant.delete')}>
                              <X size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {note && <p className="text-xs text-ink-3">{note}</p>}
      {deck.error && deck.error !== 'token' && <p className="text-sm text-danger">{deck.error}</p>}
    </div>
  );
}
