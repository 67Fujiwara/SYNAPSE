import { useEffect, useRef } from 'react';
import type { DisplayTurn } from './useConversation';
import { cx } from '@/lib/util';

/** Subtitle-style transcript: AI large, user slightly smaller; interim text in muted color. */
export function Transcript({
  turns,
  draft,
  interim,
  placeholder,
  jaMode,
  onToggleJa,
  jaLabel,
  onWord,
}: {
  turns: DisplayTurn[];
  draft: string;
  interim: string;
  placeholder: string;
  /** 'always' (Low) shows subtitles; 'tap' (Medium) hides them behind a button; 'off' (High) never. */
  jaMode: 'always' | 'tap' | 'off';
  onToggleJa: (id: string) => void;
  jaLabel: string;
  /** Tap on a word of an AI line (word popup). */
  onWord?: (word: string, sentence: string) => void;
}) {
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
          {t.role === 'ai' && !t.streaming && onWord ? <Tappable text={t.text} onWord={onWord} /> : t.text}
          {t.streaming && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent align-middle" />}
          {t.role === 'ai' && jaMode !== 'off' && t.ja && (
            <div className="ml-9 mt-1 flex items-start gap-2 text-[0.72em] font-normal leading-snug text-ink-2">
              {jaMode === 'tap' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleJa(t.id);
                  }}
                  className={cx(
                    'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] leading-none transition',
                    t.jaShown ? 'border-accent/60 text-accent' : 'border-line text-ink-3 hover:text-ink',
                  )}
                  aria-pressed={Boolean(t.jaShown)}
                >
                  {jaLabel}
                </button>
              )}
              {(jaMode === 'always' || t.jaShown) && <span>{t.ja}</span>}
            </div>
          )}
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

/** Splits a sentence into tappable words (punctuation stays attached visually, stripped for lookup). */
function Tappable({ text, onWord }: { text: string; onWord: (word: string, sentence: string) => void }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((p, i) => {
        if (!p.trim()) return <span key={i}>{p}</span>;
        const clean = p.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
        if (!clean) return <span key={i}>{p}</span>;
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onWord(clean, text);
            }}
            className="rounded-sm hover:bg-accent/15 hover:text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            {p}
          </button>
        );
      })}
    </>
  );
}
