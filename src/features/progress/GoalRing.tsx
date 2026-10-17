import { clamp } from '@/lib/util';

export function GoalRing({ value, goal, size = 140 }: { value: number; goal: number; size?: number }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const p = goal > 0 ? clamp(value / goal, 0, 1) : 0;
  const done = p >= 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(value)} of ${goal} minutes`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-surface-2))" strokeWidth="10" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={done ? 'rgb(var(--c-lime))' : 'rgb(var(--c-accent))'}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset .6s ease' }}
      />
      <text x="50%" y="48%" textAnchor="middle" fill="rgb(var(--c-ink))" fontSize={size * 0.24} fontWeight={600} fontFamily="Space Grotesk, Inter, sans-serif">
        {Math.round(value)}
      </text>
      <text x="50%" y="66%" textAnchor="middle" fill="rgb(var(--c-ink-3))" fontSize={size * 0.09}>
        / {goal} min
      </text>
    </svg>
  );
}
