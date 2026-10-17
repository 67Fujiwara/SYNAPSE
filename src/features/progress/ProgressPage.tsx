import { useState } from 'react';
import { Card, Stat } from '@/components/ui/Card';
import { useT } from '@/i18n';
import { useStats } from './useStats';
import { MinutesChart } from './MinutesChart';
import { cx } from '@/lib/util';

export function ProgressPage() {
  const { t } = useT();
  const [range, setRange] = useState<7 | 30>(7);
  const { stats } = useStats(range);

  const best = stats?.days.reduce((a, d) => (d.speakingSec > a.speakingSec ? d : a), stats.days[0]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">{t('progress.title')}</h1>
        <div className="flex rounded-lg border border-line p-0.5 text-sm">
          {([7, 30] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cx('rounded-md px-3 py-1', range === r ? 'bg-surface-2 text-ink' : 'text-ink-2')}
            >
              {r === 7 ? t('progress.range.week') : t('progress.range.month')}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <h2 className="mb-2 font-display text-base font-semibold">{t('progress.minutes')}</h2>
        {stats ? <MinutesChart days={stats.days} height={240} /> : <div className="h-[240px] animate-pulse rounded-xl bg-surface-2/60" />}
      </Card>

      {stats && (
        <Card className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label={t('progress.totalMin')} value={Math.round(stats.totals.speakingSec / 60)} />
          <Stat label={t('progress.totalWords')} value={stats.totals.words.toLocaleString()} />
          <Stat label={t('progress.sessions')} value={stats.totals.sessions} />
          <Stat
            label={t('progress.best')}
            value={best ? `${Math.round(best.speakingSec / 60)} min` : '—'}
            sub={best && best.speakingSec > 0 ? best.date : undefined}
          />
        </Card>
      )}
    </div>
  );
}
