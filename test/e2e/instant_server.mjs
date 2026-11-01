// Server-engine drill with Chromium's fake mic: tone bursts = speech; /api/transcribe is mocked
// to answer whatever cue is on screen (contracted form), or '' while `noise` is on.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
/** CHROME_PATH, or the Chromium that Playwright keeps under PLAYWRIGHT_BROWSERS_PATH (default /opt/pw-browsers). */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const d = fs.readdirSync(base).find((x) => x.startsWith('chromium-'));
  return `${base}/${d}/chrome-linux/chrome`;
}
const [OUT, WAV, TOKEN] = [process.argv[2], process.argv[3], process.argv[4]];
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
for (let i = 0; i < 60; i++) { try { await fetch('http://127.0.0.1:5173/'); await fetch('http://127.0.0.1:8787/api/health'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
const items = await (await fetch('http://127.0.0.1:8787/api/instant/items?level=1', { headers: H })).json();
const byCue = new Map(items.map((i) => [i.cue, i.answer]));
const browser = await chromium.launch({ executablePath: chromePath(),
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, permissions: ['microphone'] });
const errors = [];
ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/500|404|401/.test(m.text())) errors.push(m.text()); }); });
await ctx.addInitScript((token) => {
  try { localStorage.setItem('synapse.token', token); } catch {}
  const fakeSynth = { getVoices: () => [], speak: (u) => setTimeout(() => u.onend && u.onend({}), 30), cancel() {}, speaking: false, onvoiceschanged: null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'speechSynthesis', { value: fakeSynth });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
}, TOKEN);
let uploads = 0;
let noise = false;
let page;
const contract = (s) => s.replace(/\bI am\b/g, "I'm").replace(/\bdo not\b/g, "don't").replace(/\.$/, '');
await ctx.route('**/api/transcribe', async (r) => {
  uploads++;
  const cue = await page.textContent('.font-display.text-2xl.font-medium').catch(() => '');
  const text = noise ? '' : contract(byCue.get(cue?.trim()) ?? 'I have two meetings today');
  await new Promise((res) => setTimeout(res, 400));
  await r.fulfill({ json: { text, engine: 'mock' } });
});
await fetch('http://127.0.0.1:8787/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ sttEngine: 'server', ttsEngine: 'browser', uiLang: 'en', silenceSec: 1.0 }) });
page = await ctx.newPage();
await page.goto('http://127.0.0.1:5173/instant');
await page.waitForTimeout(1000);
await page.locator('button:has-text("Start")').first().click();
await page.waitForSelector('text=Japanese → English');
const t0 = Date.now();
const seen = new Set();
for (let i = 0; i < 60; i++) {
  const b = await page.textContent('body');
  if (/Listening…/.test(b)) seen.add('listening');
  if (/Transcribing…/.test(b)) seen.add('transcribing');
  if (/Repeat the model answer/.test(b)) { seen.add('result'); break; }
  await page.waitForTimeout(150);
}
let body = await page.textContent('body');
console.log('cue 1 ->', [...seen].join(','), '| score', body.match(/(\d+)%/)?.[0], '| latency', body.match(/(\d\.\d)s/)?.[0], '| uploads', uploads, '| after', ((Date.now() - t0) / 1000).toFixed(1), 's');
// Bursts 2..4 arrive as repeats -> log lines, dots fill, auto-advance to 2/10.
let advanced = false;
for (let i = 0; i < 120; i++) { if (/2 \/ 10/.test(await page.textContent('body'))) { advanced = true; break; } await page.waitForTimeout(200); if (i === 20) await page.screenshot({ path: `${OUT}/60-server-repeats.png`, fullPage: true }); }
console.log('auto-advanced after 3 repeats:', advanced, '| uploads so far', uploads);
// Cue 2: everything the mic sends comes back empty (noise). Expect Listening -> Transcribing -> clock resumes, never a result.
noise = true;
const states = [];
let resumed = false;
for (let i = 0; i < 80; i++) {
  const b = await page.textContent('body');
  const st = /Transcribing…/.test(b) ? 'T' : /Listening…/.test(b) ? 'L' : /Repeat the model/.test(b) ? 'R' : 'C';
  if (states[states.length - 1] !== st) states.push(st);
  if (states.includes('T') && st === 'C') { resumed = true; break; }
  if (st === 'R') break;
  await page.waitForTimeout(150);
}
body = await page.textContent('body');
console.log('noise on cue 2 -> states', states.join(''), '| clock resumed:', resumed, '| timer', body.match(/\d\.\ds/)?.[0]);
await page.screenshot({ path: `${OUT}/61-server-noise-resumed.png`, fullPage: true });
noise = false;
// Next burst is real again -> cue 2 answered.
for (let i = 0; i < 80; i++) { if (/Repeat the model/.test(await page.textContent('body'))) break; await page.waitForTimeout(150); }
body = await page.textContent('body');
console.log('cue 2 resolved:', body.match(/Time's up|(\d+)%/)?.[0], '| latency', body.match(/(\d\.\d)s/)?.[0]);
// Press Next while a clip is mid-air: the leftover must not score the next cue.
await page.waitForTimeout(1300); // a burst is likely in progress now
await page.locator('button:has-text("Next")').click();
await page.waitForTimeout(900);
body = await page.textContent('body');
console.log('right after Next: still on cue (no instant NG):', /3 \/ 10/.test(body) && !/Repeat the model/.test(body));
await page.screenshot({ path: `${OUT}/62-server-after-next.png`, fullPage: true });
console.log('errors:', errors);
await browser.close();
