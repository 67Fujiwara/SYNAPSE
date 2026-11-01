// Shadowing karaoke with the server voice: /api/tts returns a WAV with a known voice layout
// (0.4 s silence, 0.5 s voice "Not bad.", 0.3 s pause, 1.2 s voice "Just trying to survive Monday.", 0.2 s tail).
// The highlighted word must follow the voice, not the clock.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const d = fs.readdirSync(base).find((x) => x.startsWith('chromium-'));
  return `${base}/${d}/chrome-linux/chrome`;
}
const [OUT, TOKEN] = [process.argv[2], process.argv[3]];
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function wav(segs) {
  const sr = 16000;
  const n = segs.reduce((a, [d]) => a + Math.round(d * sr), 0);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let i = 0;
  for (const [d, on] of segs) { const m = Math.round(d * sr); for (let k = 0; k < m; k++, i++) { const tt = k / sr; const v = on ? Math.round(9000 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 5 * tt)) * Math.sin(2 * Math.PI * (200 + 1500 * ((tt * 4) % 1)) * tt)) : 0; buf.writeInt16LE(v, 44 + i * 2); } }
  return buf;
}
const audio = wav([[0.4, 0], [0.5, 1], [0.3, 0], [1.2, 1], [0.2, 0]]);
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const errors = [];
ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/500|501|404|401/.test(m.text())) errors.push(m.text()); }); });
await ctx.addInitScript((token) => { try { localStorage.setItem('synapse.token', token); } catch {} }, TOKEN);
await ctx.route('**/api/tts', (r) => r.fulfill({ status: 200, headers: { 'Content-Type': 'audio/wav' }, body: audio }));
await ctx.route('**/api/health', (r) => r.fulfill({ json: { ok: true, hasKey: true, keyStatus: 'ok', keyMessage: '', keyHint: '', hasWorkspace: false, stt: true, tts: true } }));
await fetch('http://127.0.0.1:8787/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ ttsEngine: 'server', sttEngine: 'browser', uiLang: 'en', rate: 1.0 }) });
const TEXT = 'Not bad. Just trying to survive Monday.';
await fetch('http://127.0.0.1:8787/api/shadow/items', { method: 'POST', headers: H, body: JSON.stringify({ items: [{ text: TEXT, source: 'manual' }] }) });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5173/shadow');
await page.waitForSelector('h1:has-text("Shadow")');
await page.locator(`button:has-text("${TEXT}")`).first().click();
await page.waitForSelector('button:has-text("Play")');
await page.click('button:has-text("Play")');
const samples = [];
for (let i = 0; i < 70; i++) {
  const s = await page.evaluate(() => { const a = document.querySelector('audio'); const hi = document.querySelector('.card span.bg-accent\\/25'); return { t: a ? a.currentTime : -1, w: hi ? hi.textContent.trim() : null }; });
  if (s.t >= 0) samples.push(s);
  await sleep(40);
}
const at = (t) => samples.filter((s) => Math.abs(s.t - t) < 0.08).map((s) => s.w);
console.log('samples', samples.length, '| during lead silence (0.2s):', at(0.2), '| first phrase (0.6s):', at(0.6), '| in the pause (1.05s):', at(1.05), '| start of 2nd phrase (1.3s):', at(1.3), '| late (2.2s):', at(2.2));
const ok1 = at(0.6).every((w) => w === 'Not' || w === 'bad.');
const ok2 = at(1.3).every((w) => w === 'Just' || w === 'bad.');
const ok3 = at(2.2).every((w) => /survive|Monday|to/.test(w ?? ''));
console.log('highlight follows the voice:', ok1 && ok2 && ok3, '| errors', errors);
await fetch('http://127.0.0.1:8787/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ ttsEngine: 'server', sttEngine: 'server' }) });
await browser.close();
