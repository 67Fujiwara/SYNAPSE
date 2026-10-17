import { useEffect, useRef } from 'react';
import { MicAnalyser } from '@/lib/speech/audio';

/** Mic level bars. Flat when the mic is off; alive while you talk. */
export function Waveform({ active, height = 56 }: { active: boolean; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const analyser = useRef<MicAnalyser | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let alive = true;
    const bars = 48;
    const smoothed = new Float32Array(bars);

    const draw = () => {
      if (!alive) return;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = height;
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr;
        el.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const levels = analyser.current?.levels() ?? new Float32Array(0);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim();
      const ink3 = getComputedStyle(document.documentElement).getPropertyValue('--c-ink-3').trim();
      const gap = 3;
      const bw = (w - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i++) {
        // sample low..mid frequencies (voice) across the bars
        const idx = Math.floor((i / bars) * Math.min(levels.length, 64));
        const target = active && levels.length ? levels[idx] : 0;
        smoothed[i] += (target - smoothed[i]) * 0.35;
        const bh = Math.max(3, smoothed[i] * (h - 6));
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        ctx.fillStyle = active ? `rgb(${accent} / ${0.35 + smoothed[i] * 0.65})` : `rgb(${ink3} / 0.35)`;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, bw / 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [active, height]);

  useEffect(() => {
    if (active) {
      analyser.current ??= new MicAnalyser();
      void analyser.current.start();
    }
    return () => {
      if (!active) {
        analyser.current?.stop();
        analyser.current = null;
      }
    };
  }, [active]);

  useEffect(
    () => () => {
      analyser.current?.stop();
      analyser.current = null;
    },
    [],
  );

  return <canvas ref={canvas} style={{ height }} className="w-full" aria-hidden />;
}
