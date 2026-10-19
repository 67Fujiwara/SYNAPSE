import { TrendingDown, TrendingUp } from 'lucide-react';
import type { WeekAgg } from '@shared/types';
import { Card } from '@/components/ui/Card';
import { useT } from '@/i18n';
import { cx } from '@/lib/util';

type Metric = { key: keyof WeekAgg; labelKey: string; lowerIsBetter?: boolean; fmt: (v: number) => string };
const METRICS: Metric[] = [
  { key: 'speakingSec', labelKey: 'week.m.minutes', fmt: (v) => `${Math.round(v / 60)} min` },
  { key: 'words', labelKey: 'week.m.words', fmt: (v) => `${Math.round(v)}` },
  { key: 'wpm', labelKey: 'week.m.wpm', fmt: (v) => `${Math.round(v)}` },
  { key: 'errorRate', labelKey: 'week.m.errors', lowerIsBetter: true, fmt: (v) => v.toFixed(1) },
  { key: 'fillerRate', labelKey: 'week.m.fillers', lowerIsBetter: true, fmt: (v) => v.toFixed(1) },
  { key: 'avgLatencySec', labelKey: 'week.m.latency', lowerIsBetter: true, fmt: (v) => `${v.toFixed(1)}s` },
  { key: 'jpHintPer100', labelKey: 'week.m.jp', lowerIsBetter: true, fmt: (v) => v.toFixed(1) },
  { key: 'shadowAvgScore', labelKey: 'week.m.shadow', fmt: (v) => `${Math.round(v)}%` },
];

/** "This week" card: totals plus the single metric that improved most vs last week. */
export function WeekCard({ current, previous }: { current: WeekAgg; previous: WeekAgg }) {
  const { t } = useT();
  let best: { m: Metric; pct: number } | null = null;
  for (const m of METRICS) {
    const a = previous[m.key];
    const b = current[m.key];
    if (!a || !b) continue;
    const pct = m.lowerIsBetter ? (a - b) / a : (b - a) / a;
    if (pct > 0.05 && (!best || pct > best.pct)) best = { m, pct };
  }
  const empty = current.sessions === 0 && current.shadowAttempts === 0;
  return (
    <Card className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wide text-ink-3">{t('week.title')}</div>
      {empty ? (
        <p className="text-sm text-ink-2">{t('week.empty')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>
              <span className="font-semibold tabular-nums">{Math.round(current.speakingSec / 60)}</span> <span className="text-ink-2">min</span>
            </span>
            <span>
              <span className="font-semibold tabular-nums">{current.words}</span> <span className="text-ink-2">{t('talk.words')}</span>
            </span>
            <span>
              <span className="font-semibold tabular-nums">{current.sessions}</span> <span className="text-ink-2">{t('progress.sessions').toLowerCase()}</span>
            </span>
          </div>
          {best ? (
            <div className={cx('flex items-center gap-2 rounded-lg bg-lime/10 px-3 py-2 text-sm text-lime')}>
              {best.m.lowerIsBetter ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
              <span>
                {t(best.m.labelKey)}: {best.m.fmt(previous[best.m.key])} → <strong>{best.m.fmt(current[best.m.key])}</strong> ({Math.round(best.pct * 100)}%)
              </span>
            </div>
          ) : (
            previous.sessions > 0 && <p className="text-xs text-ink-3">{t('week.flat')}</p>
          )}
        </>
      )}
    </Card>
  );
}
