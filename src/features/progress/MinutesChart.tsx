import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyStat } from '@shared/types';

/**
 * Single-series line (area wash) of speaking minutes per day.
 * One series -> no legend; the card title names it. Grid is hairline, recessive.
 */
export function MinutesChart({ days, height = 180 }: { days: DailyStat[]; height?: number }) {
  const data = days.map((d) => ({
    date: d.date,
    label: d.date.slice(5).replace('-', '/'),
    minutes: Math.round((d.speakingSec / 60) * 10) / 10,
  }));
  const max = Math.max(1, ...data.map((d) => d.minutes));
  const tick = data.length > 14 ? Math.ceil(data.length / 7) : 1;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 20, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="minutesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--c-accent))" stopOpacity={0.18} />
              <stop offset="100%" stopColor="rgb(var(--c-accent))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="rgb(var(--c-line))" strokeWidth={1} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={tick - 1}
            tick={{ fill: 'rgb(var(--c-ink-3))', fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            domain={[0, Math.ceil(max * 1.2)]}
            tick={{ fill: 'rgb(var(--c-ink-3))', fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: 'rgb(var(--c-ink-3))', strokeWidth: 1 }}
            contentStyle={{
              background: 'rgb(var(--c-surface))',
              border: '1px solid rgb(var(--c-line))',
              borderRadius: 10,
              fontSize: 12,
              color: 'rgb(var(--c-ink))',
            }}
            labelStyle={{ color: 'rgb(var(--c-ink-2))' }}
            formatter={(v) => [`${v} min`, '']}
          />
          <Area
            type="monotone"
            dataKey="minutes"
            stroke="rgb(var(--c-accent))"
            strokeWidth={2}
            fill="url(#minutesFill)"
            dot={{ r: 4, fill: 'rgb(var(--c-accent))', stroke: 'rgb(var(--c-surface))', strokeWidth: 2 }}
            activeDot={{ r: 5, fill: 'rgb(var(--c-accent))', stroke: 'rgb(var(--c-surface))', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
