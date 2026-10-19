import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyStat } from '@shared/types';
import { clamp } from '@/lib/util';

const TIP = {
  background: 'rgb(var(--c-surface))',
  border: '1px solid rgb(var(--c-line))',
  borderRadius: 10,
  fontSize: 12,
  color: 'rgb(var(--c-ink))',
};

/** Five skill axes, one series. 0–100 each. */
export function SkillRadar({ data }: { data: { axis: string; value: number }[] }) {
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="rgb(var(--c-line))" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: 'rgb(var(--c-ink-2))', fontSize: 12 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar dataKey="value" stroke="rgb(var(--c-accent))" strokeWidth={2} fill="rgb(var(--c-accent))" fillOpacity={0.15} isAnimationActive={false} dot={{ r: 4, fill: 'rgb(var(--c-accent))', stroke: 'rgb(var(--c-surface))', strokeWidth: 2 }} />
          <Tooltip contentStyle={TIP} formatter={(v) => [`${v}`, '']} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Practice minutes by mode (last 30 days). Magnitude comparison -> one hue, labels carry identity. */
export function ModeBars({ data }: { data: { mode: string; minutes: number }[] }) {
  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="rgb(var(--c-line))" />
          <XAxis dataKey="mode" tickLine={false} axisLine={false} tick={{ fill: 'rgb(var(--c-ink-2))', fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: 'rgb(var(--c-ink-3))', fontSize: 11 }} />
          <Tooltip cursor={{ fill: 'rgb(var(--c-surface-2))' }} contentStyle={TIP} formatter={(v) => [`${v} min`, '']} />
          <Bar dataKey="minutes" fill="rgb(var(--c-accent))" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** GitHub-style activity heatmap: 53 weeks × 7 days, one hue, 5 steps. */
export function Heatmap({ days, onHover }: { days: DailyStat[]; onHover?: (d: DailyStat | null) => void }) {
  const cell = 11;
  const gap = 3;
  const minutes = days.map((d) => d.speakingSec / 60);
  const max = Math.max(10, ...minutes);
  // Align the first column to Monday by padding the leading days.
  const first = days[0] ? new Date(days[0].date + 'T00:00:00Z').getUTCDay() : 1; // 0 = Sun
  const lead = (first + 6) % 7;
  const cols = Math.ceil((lead + days.length) / 7);
  const width = cols * (cell + gap) + 28;
  const height = 7 * (cell + gap) + 18;
  const level = (m: number) => (m <= 0 ? 0 : m < max * 0.25 ? 1 : m < max * 0.5 ? 2 : m < max * 0.75 ? 3 : 4);
  const fill = (lv: number) => (lv === 0 ? 'rgb(var(--c-surface-2))' : `rgb(var(--c-accent) / ${[0, 0.3, 0.5, 0.75, 1][lv]})`);
  const months: { x: number; label: string }[] = [];
  days.forEach((d, i) => {
    if (d.date.endsWith('-01') || i === 0) {
      const col = Math.floor((i + lead) / 7);
      const m = Number(d.date.slice(5, 7));
      months.push({ x: 28 + col * (cell + gap), label: String(m) });
    }
  });
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Daily speaking minutes for the last year" className="block">
        {['M', 'W', 'F'].map((l, i) => (
          <text key={l} x={0} y={18 + (i * 2 + 0) * (cell + gap) + cell} fontSize={10} fill="rgb(var(--c-ink-3))">
            {l}
          </text>
        ))}
        {months.map((m, i) => (
          <text key={i} x={m.x} y={10} fontSize={10} fill="rgb(var(--c-ink-3))">
            {m.label}
          </text>
        ))}
        {days.map((d, i) => {
          const idx = i + lead;
          const col = Math.floor(idx / 7);
          const row = idx % 7;
          const lv = level(d.speakingSec / 60);
          return (
            <rect
              key={d.date}
              x={28 + col * (cell + gap)}
              y={18 + row * (cell + gap)}
              width={cell}
              height={cell}
              rx={2}
              fill={fill(lv)}
              onMouseEnter={() => onHover?.(d)}
              onMouseLeave={() => onHover?.(null)}
            >
              <title>
                {d.date}: {Math.round(d.speakingSec / 60)} min
              </title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

// ---- Level (CEFR estimate) ----------------------------------------------------------------------------------

export type Cefr = 'A2' | 'B1' | 'B2' | 'C1';

export interface LevelInput {
  wpm: number;
  errorRate: number;
  avgSentLen: number;
  totalMinutes: number;
}

interface Criterion {
  key: keyof LevelInput;
  label: string;
  min?: number;
  max?: number;
}

export const LEVELS: { level: Cefr; criteria: Criterion[] }[] = [
  { level: 'B1', criteria: [{ key: 'wpm', label: 'WPM', min: 80 }, { key: 'errorRate', label: 'errors / 100 words', max: 8 }, { key: 'totalMinutes', label: 'total minutes', min: 60 }] },
  { level: 'B2', criteria: [{ key: 'wpm', label: 'WPM', min: 110 }, { key: 'errorRate', label: 'errors / 100 words', max: 5 }, { key: 'avgSentLen', label: 'words / sentence', min: 8 }, { key: 'totalMinutes', label: 'total minutes', min: 300 }] },
  { level: 'C1', criteria: [{ key: 'wpm', label: 'WPM', min: 140 }, { key: 'errorRate', label: 'errors / 100 words', max: 3 }, { key: 'avgSentLen', label: 'words / sentence', min: 10 }, { key: 'totalMinutes', label: 'total minutes', min: 1000 }] },
];

export function estimateLevel(input: LevelInput): { level: Cefr; next: Cefr | null; unmet: { label: string; have: number; need: string }[] } {
  let level: Cefr = 'A2';
  for (const l of LEVELS) {
    const ok = l.criteria.every((c) => (c.min === undefined || input[c.key] >= c.min) && (c.max === undefined || input[c.key] <= c.max));
    if (ok) level = l.level;
    else break;
  }
  const nextDef = LEVELS.find((l) => l.level > level) ?? null;
  const unmet = nextDef
    ? nextDef.criteria
        .filter((c) => !((c.min === undefined || input[c.key] >= c.min) && (c.max === undefined || input[c.key] <= c.max)))
        .map((c) => ({ label: c.label, have: Math.round(input[c.key] * 10) / 10, need: c.min !== undefined ? `≥ ${c.min}` : `≤ ${c.max}` }))
    : [];
  return { level, next: nextDef?.level ?? null, unmet };
}

/** Radar axes from recent sessions and shadowing (0–100). */
export function skillScores(sessions: { wpm: number; fillerRate: number; errorRate: number; uniqueWords: number; jpHintCount: number; words: number }[], shadowAvg: number) {
  const n = sessions.length || 1;
  const avg = (f: (s: (typeof sessions)[number]) => number) => sessions.reduce((a, s) => a + f(s), 0) / n;
  const words = sessions.reduce((a, s) => a + s.words, 0) || 1;
  const jpPer100 = (sessions.reduce((a, s) => a + s.jpHintCount, 0) / words) * 100;
  const pct = (x: number) => Math.round(clamp(x, 0, 1) * 100);
  return {
    fluency: sessions.length ? pct((avg((s) => s.wpm) / 150) * (1 - Math.min(avg((s) => s.fillerRate), 10) / 20)) : 0,
    accuracy: sessions.length ? pct(1 - avg((s) => s.errorRate) / 10) : 0,
    vocabulary: sessions.length ? pct(avg((s) => s.uniqueWords) / 120) : 0,
    pronunciation: Math.round(clamp(shadowAvg, 0, 100)),
    independence: sessions.length ? pct(1 - jpPer100 / 5) : 0,
  };
}

/** XP -> level. Level n needs 100·n² total XP (L1 100, L2 400, L3 900 …). */
export function xpLevel(xp: number): { level: number; into: number; need: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 100));
  const base = 100 * level * level;
  const next = 100 * (level + 1) * (level + 1);
  return { level, into: xp - base, need: next - base };
}

export const MILESTONES: { id: string; key: 'words' | 'minutes' | 'sessions' | 'streak'; at: number }[] = [
  { id: 'w1k', key: 'words', at: 1000 },
  { id: 'w5k', key: 'words', at: 5000 },
  { id: 'w10k', key: 'words', at: 10000 },
  { id: 'w50k', key: 'words', at: 50000 },
  { id: 'm60', key: 'minutes', at: 60 },
  { id: 'm300', key: 'minutes', at: 300 },
  { id: 'm1000', key: 'minutes', at: 1000 },
  { id: 's10', key: 'sessions', at: 10 },
  { id: 's50', key: 'sessions', at: 50 },
  { id: 's100', key: 'sessions', at: 100 },
  { id: 'st7', key: 'streak', at: 7 },
  { id: 'st30', key: 'streak', at: 30 },
  { id: 'st100', key: 'streak', at: 100 },
];
