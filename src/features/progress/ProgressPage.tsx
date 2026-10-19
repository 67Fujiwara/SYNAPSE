import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, Star } from 'lucide-react';
import type { DailyStat, ProgressResponse } from '@shared/types';
import { Button } from '@/components/ui/Button';
import { Card, Stat } from '@/components/ui/Card';
import { useT } from '@/i18n';
import { api, getToken } from '@/lib/api/client';
import { cx, fmtMinutes } from '@/lib/util';
import { MinutesChart } from './MinutesChart';
import { estimateLevel, Heatmap, MILESTONES, ModeBars, SkillRadar, skillScores, xpLevel } from './charts';

export function ProgressPage() {
  const { t } = useT();
  const [range, setRange] = useState<7 | 30>(7);
  const [p, setP] = useState<ProgressResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<DailyStat | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    api.progress().then(setP).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  if (!getToken()) {
    return (
      <Card className="flex items-center justify-between">
        <span className="text-sm text-ink-2">{t('talk.noToken')}</span>
        <Link to="/settings">
          <Button size="sm">{t('nav.settings')}</Button>
        </Link>
      </Card>
    );
  }
  if (err) return <p className="text-sm text-danger">{err}</p>;
  if (!p) return <div className="h-40 animate-pulse rounded-xl bg-surface-2/60" />;

  const recent = p.recent.slice(0, 10);
  const avg = (f: (s: (typeof recent)[number]) => number) => (recent.length ? recent.reduce((a, s) => a + f(s), 0) / recent.length : 0);
  const lvl = estimateLevel({ wpm: avg((s) => s.wpm), errorRate: avg((s) => s.errorRate), avgSentLen: avg((s) => s.avgSentLen), totalMinutes: p.totals.speakingSec / 60 });
  const skills = skillScores(recent, p.shadow.avgScore);
  const radar = [
    { axis: t('progress.skill.fluency'), value: skills.fluency },
    { axis: t('progress.skill.accuracy'), value: skills.accuracy },
    { axis: t('progress.skill.vocabulary'), value: skills.vocabulary },
    { axis: t('progress.skill.pronunciation'), value: skills.pronunciation },
    { axis: t('progress.skill.independence'), value: skills.independence },
  ];
  const modes = (['daily', 'business', 'mywork', 'free', 'shadow'] as const).map((m) => ({ mode: t(`progress.mode.${m}`), minutes: Math.round(p.modes[m] / 60) }));
  const xp = xpLevel(p.totals.xp);
  const days = p.days.slice(range === 7 ? -7 : -30);
  const best = days.reduce((a, d) => (d.speakingSec > a.speakingSec ? d : a), days[0]);
  const have = { words: p.totals.words, minutes: p.totals.speakingSec / 60, sessions: p.totals.sessions, streak: p.streak };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">{t('progress.title')}</h1>
        <div className="flex rounded-lg border border-line p-0.5 text-sm">
          {([7, 30] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={cx('rounded-md px-3 py-1', range === r ? 'bg-surface-2 text-ink' : 'text-ink-2')}>
              {r === 7 ? t('progress.range.week') : t('progress.range.month')}
            </button>
          ))}
        </div>
      </div>

      {/* Level + XP */}
      <Card className="grid gap-5 md:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 place-items-center rounded-2xl bg-accent/15 font-display text-3xl font-semibold text-accent">{lvl.level}</div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-3">{t('progress.level')}</div>
            <div className="text-sm text-ink-2">{t(`progress.level.${lvl.level}`)}</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-ink-2">
              <Star size={14} className="text-warn" /> Lv.{xp.level} · {p.totals.xp} XP
              <span className="ml-1 inline-block h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                <span className="block h-full bg-warn" style={{ width: `${Math.round((xp.into / xp.need) * 100)}%` }} />
              </span>
            </div>
          </div>
        </div>
        <div>
          {lvl.next ? (
            <>
              <div className="text-xs uppercase tracking-wide text-ink-3">{t('progress.nextLevel', { level: lvl.next })}</div>
              <ul className="mt-1 text-sm text-ink-2">
                {lvl.unmet.map((u) => (
                  <li key={u.label}>
                    {u.label}: <span className="text-ink">{u.have}</span> → {u.need}
                  </li>
                ))}
                {lvl.unmet.length === 0 && <li>{t('progress.keepGoing')}</li>}
              </ul>
            </>
          ) : (
            <div className="text-sm text-ink-2">{t('progress.top')}</div>
          )}
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <h2 className="mb-1 font-display text-base font-semibold">{t('progress.skills')}</h2>
          <p className="mb-2 text-xs text-ink-3">{t('progress.skills.sub')}</p>
          <SkillRadar data={radar} />
        </Card>
        <Card>
          <h2 className="mb-1 font-display text-base font-semibold">{t('progress.modes')}</h2>
          <p className="mb-2 text-xs text-ink-3">{t('progress.modes.sub')}</p>
          <ModeBars data={modes} />
        </Card>
      </div>

      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-base font-semibold">{t('progress.year')}</h2>
          <span className="text-xs text-ink-3">{hover ? `${hover.date} · ${Math.round(hover.speakingSec / 60)} min · ${hover.words} w` : t('progress.year.sub')}</span>
        </div>
        <Heatmap days={p.days} onHover={setHover} />
      </Card>

      <Card>
        <h2 className="mb-2 font-display text-base font-semibold">{t('progress.minutes')}</h2>
        <MinutesChart days={days} height={220} />
      </Card>

      <Card className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label={t('progress.totalMin')} value={Math.round(p.totals.speakingSec / 60)} />
        <Stat label={t('progress.totalWords')} value={p.totals.words.toLocaleString()} />
        <Stat label={t('progress.sessions')} value={p.totals.sessions} />
        <Stat label={t('progress.best')} value={best ? `${Math.round(best.speakingSec / 60)} min` : '—'} sub={best && best.speakingSec > 0 ? best.date : undefined} />
      </Card>

      <Card className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label={t('progress.shadow.attempts')} value={p.shadow.attempts} />
        <Stat label={t('progress.shadow.avg')} value={`${p.shadow.avgScore}%`} />
        <Stat label={t('progress.shadow.bestWpm')} value={p.shadow.bestWpm} />
        <Stat label={t('progress.shadow.time')} value={fmtMinutes(p.shadow.durationSec)} />
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-base font-semibold">{t('progress.milestones')}</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MILESTONES.map((m) => {
            const done = have[m.key] >= m.at;
            return (
              <li key={m.id} className={cx('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', done ? 'border-lime/40 text-ink' : 'border-line text-ink-3')}>
                <Award size={16} className={done ? 'text-lime' : 'text-ink-3'} />
                {t(`progress.ms.${m.key}`, { n: m.at.toLocaleString() })}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 font-display text-base font-semibold">{t('progress.mastered')}</h2>
        {p.shadow.mastered.length === 0 ? (
          <p className="text-sm text-ink-2">{t('progress.mastered.empty')}</p>
        ) : (
          <ul className="divide-y divide-line/70 text-sm">
            {p.shadow.mastered.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2">
                <span>{i.text}</span>
                <span className="text-xs tabular-nums text-ink-3">{Math.round(i.bestScore)}% · {i.bestWpm} wpm</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
