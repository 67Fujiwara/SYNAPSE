import { useEffect, useRef } from 'react';
import type { DisplayTurn } from './useConversation';
import { cx } from '@/lib/util';

/** Subtitle-style transcript: AI large, user slightly smaller; interim text in muted color. */
export function Transcript({ turns, draft, interim, placeholder }: { turns: DisplayTurn[]; draft: string; interim: string; placeholder: string }) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, draft, interim]);

  const empty = turns.length === 0 && !draft && !interim;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 overflow-y-auto px-5 py-6">
      {empty && <p className="m-auto text-center text-ink-3">{placeholder}</p>}
      {turns.map((t) => (
        <div key={t.id} className={cx('transcript-text', t.role === 'ai' ? 'text-ink font-medium' : 'text-ink-2 text-[0.9em]')}>
          <span className="mr-2 inline-block w-7 text-xs uppercase tracking-wider text-ink-3 align-middle">{t.role === 'ai' ? 'AI' : 'You'}</span>
          {t.text}
          {t.streaming && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent align-middle" />}
        </div>
      ))}
      {(draft || interim) && (
        <div className="transcript-text text-ink-2 text-[0.9em]">
          <span className="mr-2 inline-block w-7 text-xs uppercase tracking-wider text-ink-3 align-middle">You</span>
          {draft}
          {interim && <span className="interim"> {interim}</span>}
        </div>
      )}
      <div ref={bottom} />
    </div>
  );
}
