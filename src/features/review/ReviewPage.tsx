import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Sparkles } from 'lucide-react';
import type { RecordingMeta, Review, ReviewSummary, Session, Turn } from '@shared/types';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useT } from '@/i18n';
import { useSettings } from '@/features/settings/SettingsProvider';
import { api, getToken } from '@/lib/api/client';
import { cx, fmtMinutes } from '@/lib/util';

export function ReviewPage() {
  const { t } = useT();
  const { settings } = useSettings();
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const [r, s] = await Promise.all([api.reviews(30), api.sessions(30)]);
    setReviews(r);
    setSessions(s);
    if (!open && r[0]) setOpen(r[0].review.sessionId);
  };
  useEffect(() => {
    if (getToken()) void load().catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async (sessionId: string) => {
    setBusy(sessionId);
    setErr(null);
    try {
      const payload = await api.session(sessionId);
      await api.review(sessionId, payload.turns, settings.reviewModel);
      await load();
      setOpen(sessionId);
    } catch (e) {
      setErr(t('review.failed', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };

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

  const reviewed = new Set(reviews?.map((r) => r.review.sessionId));
  const unreviewed = sessions.filter((s) => !reviewed.has(s.id) && s.words > 0);
  const current = reviews?.find((r) => r.review.sessionId === open);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl font-semibold">{t('review.title')}</h1>
      {err && <p className="text-sm text-danger">{err}</p>}

      {reviews && reviews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {reviews.map((r) => (
            <button
              key={r.review.id}
              onClick={() => setOpen(r.review.sessionId)}
              className={cx('rounded-lg border px-3 py-1.5 text-xs', open === r.review.sessionId ? 'border-accent text-ink' : 'border-line text-ink-2 hover:text-ink')}
            >
              {new Date(r.session.endedAt).toLocaleDateString()} · {r.session.mode} · {fmtMinutes(r.session.speakingSec)}
            </button>
          ))}
        </div>
      )}

      {current ? (
        <>
          <ReviewView review={current.review} />
          <SessionTranscript sessionId={current.review.sessionId} />
        </>
      ) : (
        reviews && reviews.length === 0 && unreviewed.length === 0 && <p className="text-sm text-ink-2">{t('review.empty')}</p>
      )}

      {unreviewed.length > 0 && (
        <Card>
          <h2 className="mb-2 font-display text-base font-semibold">{t('review.sessions')}</h2>
          <ul className="divide-y divide-line/70">
            {unreviewed.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink-2">
                  {new Date(s.endedAt).toLocaleString()} · {s.mode} · {s.words} w
                </span>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void generate(s.id)}>
                  <Sparkles size={14} /> {busy === s.id ? t('review.generating') : t('review.generate')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function ReviewView({ review, compact }: { review: Review; compact?: boolean }) {
  const { t } = useT();
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const toShadow = async (text: string, source: 'review' = 'review') => {
    await api.addShadowItems([{ text, source }]);
    setSaved((s) => new Set(s).add(text));
  };

  const AddBtn = ({ text }: { text: string }) => (
    <button
      onClick={() => void toShadow(text)}
      disabled={saved.has(text)}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50"
    >
      <Plus size={12} /> {saved.has(text) ? t('shadow.saved') : t('shadow.toShadow')}
    </button>
  );

  return (
    <div className={cx('flex flex-col gap-4', compact && 'gap-3')}>
      {review.wins.length > 0 && (
        <Card className="border-lime/40">
          <h3 className="mb-1 text-xs uppercase tracking-wide text-lime">{t('review.wins')}</h3>
          {review.wins.map((w, i) => (
            <p key={i} className="text-sm">
              {w}
            </p>
          ))}
        </Card>
      )}

      <Card>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-3">{t('review.corrections')}</h3>
        {review.corrections.length === 0 ? (
          <p className="text-sm text-ink-2">{t('review.noCorrections')}</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {(compact ? review.corrections.slice(0, 3) : review.corrections).map((c, i) => (
              <li key={i} className="flex flex-col gap-1 py-3">
                <div className="text-sm text-ink-3 line-through decoration-ink-3/50">{c.original}</div>
                <div className="flex items-start justify-between gap-3">
                  <div className="text-base font-medium text-ink">{c.fixed}</div>
                  <AddBtn text={c.fixed} />
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-2">
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 uppercase tracking-wide text-[10px]">{t(`review.tag.${c.tag}`)}</span>
                  {c.reason}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!compact && review.betterPhrases.length > 0 && (
        <Card>
          <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-3">{t('review.better')}</h3>
          <ul className="flex flex-col gap-2">
            {review.betterPhrases.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-sm">
                <span>{p}</span>
                <AddBtn text={p} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!compact && review.termNotes.length > 0 && (
        <Card>
          <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-3">{t('review.terms')}</h3>
          <ul className="divide-y divide-line/70 text-sm">
            {review.termNotes.map((n, i) => (
              <li key={i} className="py-2">
                <span className="text-ink-3">{t('review.heard')}: </span>
                <span className="line-through decoration-ink-3/50">{n.heard}</span>
                <span className="mx-2 text-ink-3">→</span>
                <span className="font-medium">{n.standard}</span>
                <div className="text-xs text-ink-2">{n.note}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** The session's lines; the learner's lines get a play button when a recording exists in R2. */
function SessionTranscript({ sessionId }: { sessionId: string }) {
  const { t } = useT();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [recs, setRecs] = useState<Record<string, RecordingMeta>>({});
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.session(sessionId).then((p) => setTurns(p.turns)).catch(() => {});
    api
      .recordings(sessionId)
      .then((list) => setRecs(Object.fromEntries(list.map((r) => [r.turnId, r]))))
      .catch(() => {});
  }, [open, sessionId]);

  const play = async (turnId: string) => {
    setPlaying(turnId);
    try {
      const url = await api.recordingUrl(turnId);
      const a = new Audio(url);
      a.onended = () => {
        URL.revokeObjectURL(url);
        setPlaying(null);
      };
      await a.play();
    } catch {
      setPlaying(null);
    }
  };

  return (
    <Card>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <h3 className="text-xs uppercase tracking-wide text-ink-3">{t('review.transcript')}</h3>
        <span className="text-xs text-ink-3">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {turns.map((x) => (
            <li key={x.id} className={cx('flex items-start gap-2', x.role === 'ai' ? 'text-ink' : 'text-ink-2')}>
              <span className="mt-0.5 w-7 shrink-0 text-[10px] uppercase tracking-wider text-ink-3">{x.role === 'ai' ? 'AI' : 'You'}</span>
              <span className="flex-1">{x.text}</span>
              {x.role === 'user' && recs[x.id] && (
                <button
                  onClick={() => void play(x.id)}
                  disabled={playing === x.id}
                  className="shrink-0 rounded-md border border-line p-1 text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50"
                  aria-label={t('review.play')}
                >
                  <Play size={12} />
                </button>
              )}
            </li>
          ))}
          {turns.length > 0 && Object.keys(recs).length === 0 && <li className="text-xs text-ink-3">{t('review.noRecordings')}</li>}
        </ul>
      )}
    </Card>
  );
}
