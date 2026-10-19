import { Link } from 'react-router-dom';
import { cx } from '@/lib/util';
import { ArrowRight, Flame, Mic, Repeat, ClipboardCheck, CloudOff, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';
import { useSettings } from '@/features/settings/SettingsProvider';
import { useStats } from './useStats';
import { GoalRing } from './GoalRing';
import { MinutesChart } from './MinutesChart';
import { WeekCard } from './WeekCard';
import { xpLevel } from './charts';
import { api } from '@/lib/api/client';
import { fmtMinutes, localDate } from '@/lib/util';
import { useEffect, useState } from 'react';
import type { ProgressResponse } from '@shared/types';
import { Check, Star, Target } from 'lucide-react';

const MISSIONS = [
  'Explain what an interlock is in 3 sentences.',
  'Describe your current project to a new colleague.',
  'Report a machine fault: what happened, root cause, countermeasure.',
  'Negotiate a one-week delay on the FAT date.',
  'Walk someone through your E-stop circuit.',
  'Talk about your weekend for two minutes without stopping.',
  'Explain the difference between a relay and a contactor.',
  "Describe a drawing change you'd mark up in red.",
  'Ask a vendor three questions about lead time.',
  'Tell a story about a commissioning trip.',
];

function missionOfTheDay(): string {
  const d = localDate();
  let h = 0;
  for (const ch of d) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MISSIONS[h % MISSIONS.length];
}

export function Dashboard() {
  const { t } = useT();
  const { settings } = useSettings();
  const { stats, error, offline, pending } = useStats(7);
  const [prog, setProg] = useState<ProgressResponse | null>(null);
  useEffect(() => {
    if (error === 'token') return;
    api.progress().then(setProg).catch(() => {});
  }, [error, stats]);

  const todayMin = (stats?.today.speakingSec ?? 0) / 60;
  const mission = missionOfTheDay();
  const missionDone = Boolean(stats?.today.missionDone);
  const xp = prog ? xpLevel(prog.totals.xp) : null;

  return (
    <div className="flex flex-col gap-5">
      {error === 'token' && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-accent/40">
          <span className="text-sm text-ink-2">{t('talk.noToken')}</span>
          <Link to="/settings">
            <Button size="sm">{t('nav.settings')}</Button>
          </Link>
        </Card>
      )}
      {offline && (
        <div className="flex items-center gap-2 text-xs text-warn">
          <CloudOff size={14} /> {t('home.offline')}
        </div>
      )}
      {pending > 0 && (
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <RefreshCw size={14} /> {t('home.pending', { n: pending })}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-[auto_1fr]">
        <Card className="flex items-center gap-5">
          <GoalRing value={todayMin} goal={settings.dailyGoalMin} />
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-3">{t('home.today')}</div>
            <div className="font-display text-3xl font-semibold tabular-nums">{Math.round(todayMin)} min</div>
            <div className="text-sm text-ink-2">{t('home.goal', { min: settings.dailyGoalMin })}</div>
            <div className="mt-3 flex items-center gap-1.5 text-sm">
              <Flame size={16} className={stats && stats.streak > 0 ? 'text-warn' : 'text-ink-3'} />
              <span className="font-semibold tabular-nums">{prog?.streak ?? stats?.streak ?? 0}</span>
              <span className="text-ink-2">{t('home.streak')}</span>
              {prog?.freezeUsed && <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">{t('home.freeze')}</span>}
            </div>
            {xp && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
                <Star size={13} className="text-warn" /> Lv.{xp.level} · {prog!.totals.xp} XP
              </div>
            )}
          </div>
        </Card>

        <Card className="flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-accent">{t('home.mission')}</div>
              {missionDone && (
                <span className="flex items-center gap-1 rounded-md bg-lime/15 px-2 py-0.5 text-xs text-lime">
                  <Check size={12} /> {t('home.mission.done')}
                </span>
              )}
            </div>
            <p className={cx('mt-2 font-display text-xl font-medium leading-snug', missionDone && 'text-ink-2 line-through decoration-ink-3/50')}>{mission}</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link to={`/talk?mode=free&mission=${encodeURIComponent(mission)}`}>
              <Button size="sm" variant={missionDone ? 'ghost' : 'outline'}>
                {missionDone ? t('home.mission.again') : t('home.mission.cta')} <ArrowRight size={14} />
              </Button>
            </Link>
            {prog && (
              <span className="flex items-center gap-1.5 text-xs text-ink-2" title={t('home.challenge.help')}>
                <Target size={13} className={prog.challenge.done >= prog.challenge.target ? 'text-lime' : 'text-ink-3'} />
                {t('home.challenge', { done: Math.min(prog.challenge.done, prog.challenge.target), target: prog.challenge.target })}
              </span>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/talk" className="card group flex items-center gap-4 p-5 transition hover:border-accent/60 hover:shadow-glow">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent/15 text-accent">
            <Mic />
          </span>
          <span>
            <span className="block font-display text-lg font-semibold">{t('home.talk')}</span>
            <span className="block text-xs text-ink-2">{t('home.talk.sub')}</span>
          </span>
        </Link>
        <Link to="/shadow" className="card group flex items-center gap-4 p-5 transition hover:border-accent/60 hover:shadow-glow">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-lime/15 text-lime">
            <Repeat />
          </span>
          <span>
            <span className="block font-display text-lg font-semibold">{t('home.shadow')}</span>
            <span className="block text-xs text-ink-2">{t('home.shadow.sub')}</span>
          </span>
        </Link>
        <Link to="/review" className="card group flex items-center gap-4 p-5 transition hover:border-accent/60 hover:shadow-glow">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-warn/15 text-warn">
            <ClipboardCheck />
          </span>
          <span>
            <span className="block font-display text-lg font-semibold">{t('home.review')}</span>
            <span className="block text-xs text-ink-2">{t('home.review.sub')}</span>
          </span>
        </Link>
      </div>

      {prog && <WeekCard current={prog.week.current} previous={prog.week.previous} />}

      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-base font-semibold">{t('home.last7')}</h2>
          {stats && (
            <span className="text-xs text-ink-3">
              {t('home.totals', {
                sessions: stats.totals.sessions,
                minutes: Math.round(stats.totals.speakingSec / 60),
                words: stats.totals.words.toLocaleString(),
              })}
            </span>
          )}
        </div>
        {stats ? <MinutesChart days={stats.days} /> : <div className="h-[180px] animate-pulse rounded-xl bg-surface-2/60" />}
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-base font-semibold">{t('home.recent')}</h2>
        {!stats || stats.recent.length === 0 ? (
          <p className="text-sm text-ink-2">{t('home.none')}</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {stats.recent.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs uppercase tracking-wide text-ink-2">{s.mode}</span>
                  <span className="text-ink-2">{new Date(s.endedAt).toLocaleString()}</span>
                </div>
                <div className="flex gap-4 tabular-nums text-ink">
                  <span>{fmtMinutes(s.speakingSec)}</span>
                  <span className="text-ink-2">{s.words} w</span>
                  <span className="text-ink-2">{Math.round(s.wpm)} wpm</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
