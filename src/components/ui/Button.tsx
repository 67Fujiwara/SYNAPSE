import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/lib/util';

type Variant = 'primary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const V: Record<Variant, string> = {
  primary: 'bg-accent text-bg hover:brightness-110 shadow-glow font-semibold',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink',
  outline: 'border border-line bg-surface hover:bg-surface-2 text-ink',
  danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
};
const S: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-6 text-base rounded-xl gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center transition disabled:opacity-40 disabled:pointer-events-none select-none',
        V[variant],
        S[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
