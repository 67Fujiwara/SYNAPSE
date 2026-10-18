import { Link } from 'react-router-dom';
import type { Review, SessionPayload } from '@shared/types';
import { ReviewView } from '@/features/review/ReviewPage';
import { Card, Stat } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';
import { fmtMinutes } from '@/lib/util';

export function SummaryCard({
  payload,
  saved,
  onAgain,
  review,
  reviewState,
  reviewErr,
}: {
  payload: SessionPayload;
  saved: 'synced' | 'queued' | null;
  onAgain: () => void;
  review: Review | null;
  reviewState: 'idle' | 'loading' | 'error';
  reviewErr: string | null;
}) {
  const { t } = useT();
  const s = payload.session;
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <Card className="flex flex-col gap-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-accent">{t('summary.title')}</div>
          <div className="mt-1 text-sm text-ink-2">{t('summary.spoke')}</div>
          <div className="font-display text-5xl font-semibold tabular-nums">{fmtMinutes(s.speakingSec)}</div>
        </div>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label={t('summary.words')} value={s.words} />
          <Stat label={t('summary.wpm')} value={Math.round(s.wpm)} />
          <Stat label={t('summary.fillers')} value={s.fillerRate.toFixed(1)} />
          <Stat label={t('summary.unique')} value={s.uniqueWords} />
          {s.jpHintCount > 0 && <Stat label={t('summary.jpHints')} value={s.jpHintCount} />}
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-2">{saved === 'queued' ? t('summary.queued') : saved === 'synced' ? t('summary.saved') : '…'}</span>
          <span className="rounded-md bg-lime/15 px-2 py-0.5 font-semibold text-lime">+{s.xp} {t('summary.xp')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onAgain}>{t('summary.again')}</Button>
          <Link to="/">
            <Button variant="outline">{t('summary.home')}</Button>
          </Link>
          {review && (
            <Link to="/review">
              <Button variant="ghost">{t('review.open')}</Button>
            </Link>
          )}
        </div>
      </Card>

      <div className="mt-5">
        {reviewState === 'loading' && (
          <div className="card flex items-center gap-3 p-4 text-sm text-ink-2">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent" /> {t('review.generating')}
          </div>
        )}
        {reviewState === 'error' && <p className="text-sm text-danger">{t('review.failed', { msg: reviewErr ?? '' })}</p>}
        {review && <ReviewView review={review} compact />}
      </div>
    </div>
  );
}
