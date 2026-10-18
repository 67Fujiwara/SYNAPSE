import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import type { ShadowItem } from '@shared/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useT } from '@/i18n';
import { bankItems, BANK } from '@/data/phrasebank';
import { useShadowDeck } from './useShadowDeck';
import { Practice } from './Practice';
import { cx } from '@/lib/util';

export function ShadowPage() {
  const { t } = useT();
  const deck = useShadowDeck();
  const [current, setCurrent] = useState<ShadowItem | null>(null);
  const [manual, setManual] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const queue = [...deck.due, ...deck.later];

  const addBank = async (cat: keyof typeof BANK) => {
    const n = await deck.add(bankItems(cat));
    setNote(t('shadow.added', { n }));
  };
  const addManual = async () => {
    if (!manual.trim()) return;
    const n = await deck.add([{ text: manual.trim(), source: 'manual' }]);
    setManual('');
    setNote(t('shadow.added', { n }));
  };
  const next = () => {
    if (!current) return setCurrent(queue[0] ?? null);
    const i = queue.findIndex((x) => x.id === current.id);
    setCurrent(queue[(i + 1) % queue.length] ?? null);
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

  // ---- Practice view ----------------------------------------------------------------
  if (current) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold">{t('shadow.practice')}</h1>
          <button onClick={() => setCurrent(null)} className="text-ink-3 hover:text-ink" aria-label={t('common.close')}>
            <X />
          </button>
        </div>
        <Practice
          item={current}
          onAttempt={deck.attempt}
          onNext={next}
          onDelete={async () => {
            await deck.remove(current.id);
            setCurrent(null);
          }}
        />
      </div>
    );
  }

  // ---- Deck view ------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">{t('shadow.title')}</h1>
        {queue.length > 0 && <Button onClick={() => setCurrent(deck.due[0] ?? queue[0])}>{t('shadow.practice')}</Button>}
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-2">{t('shadow.addBank')}:</span>
          {(Object.keys(BANK) as (keyof typeof BANK)[]).map((cat) => (
            <Button key={cat} size="sm" variant="outline" onClick={() => void addBank(cat)}>
              <Plus size={14} /> {t(`shadow.bank.${cat}`)}
            </Button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addManual();
          }}
        >
          <input type="text" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t('shadow.manual.placeholder')} className="flex-1" />
          <Button size="md" variant="outline" type="submit" disabled={!manual.trim()}>
            {t('shadow.addManual')}
          </Button>
        </form>
        {note && <div className="text-xs text-ink-3">{note}</div>}
      </Card>

      {deck.loading ? (
        <div className="h-24 animate-pulse rounded-xl bg-surface-2/60" />
      ) : deck.items.length === 0 ? (
        <p className="text-sm text-ink-2">{t('shadow.empty')}</p>
      ) : (
        <>
          <Section title={`${t('shadow.due')} · ${deck.due.length}`} items={deck.due} onPick={setCurrent} t={t} />
          {deck.later.length > 0 && <Section title={`${t('shadow.later')} · ${deck.later.length}`} items={deck.later} onPick={setCurrent} t={t} dim />}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  onPick,
  t,
  dim,
}: {
  title: string;
  items: ShadowItem[];
  onPick: (i: ShadowItem) => void;
  t: (k: string, v?: Record<string, string | number>) => string;
  dim?: boolean;
}) {
  return (
    <Card className={cx(dim && 'opacity-80')}>
      <h2 className="mb-2 font-display text-base font-semibold">{title}</h2>
      <ul className="divide-y divide-line/70">
        {items.map((i) => (
          <li key={i.id}>
            <button onClick={() => onPick(i)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:text-accent">
              <span className="text-sm">{i.text}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-3">
                {i.attempts > 0 ? `${Math.round(i.bestScore)}%` : '—'}
                {i.masteredCount >= 3 && <span className="ml-1 text-lime">★ {t('shadow.mastered')}</span>}
                <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase">{i.source}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
