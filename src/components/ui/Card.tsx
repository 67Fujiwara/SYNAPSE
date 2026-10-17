import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '@/lib/util';

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cx('card p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs uppercase tracking-wide text-ink-3">{label}</div>
      <div className="font-display text-2xl font-semibold text-ink tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}
