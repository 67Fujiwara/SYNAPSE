import { cx } from '@/lib/util';

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-6 w-11 rounded-full border transition',
        checked ? 'bg-accent border-accent' : 'bg-surface-2 border-line',
      )}
    >
      <span
        className={cx(
          'absolute left-0 top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
