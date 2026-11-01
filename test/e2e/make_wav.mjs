// 16 kHz mono WAV: 1.2 s silence, then [1.0 s tone, 2.2 s silence] x 3. Chromium loops it as the fake mic.
import fs from 'node:fs';
const sr = 16000;
const seg = [[1.2, 0], [1.5, 1], [2.2, 0], [1.5, 1], [2.2, 0], [1.5, 1], [2.2, 0]];
const n = seg.reduce((a, [d]) => a + Math.round(d * sr), 0);
const buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
let i = 0;
for (const [d, on] of seg) {
  const m = Math.round(d * sr);
  for (let k = 0; k < m; k++, i++) {
    // "Speech": frequency sweeps (non-stationary, so Chrome's noise suppression leaves them alone) with a 4 Hz syllable envelope.
    const tt = k / sr;
    const f = 200 + 2200 * ((tt * 3) % 1);
    const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * tt);
    const v = on ? Math.round(9000 * env * Math.sin(2 * Math.PI * f * tt)) : 0;
    buf.writeInt16LE(v, 44 + i * 2);
  }
}
fs.writeFileSync(process.argv[2], buf);
console.log('wav ok', n / sr, 's');
