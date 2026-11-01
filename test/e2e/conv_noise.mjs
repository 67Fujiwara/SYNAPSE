// Continuous mic + noisy street: the mock transcriber returns one word per clip ("you"),
// so the conversation should fall back to tap-to-talk after three such turns.
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
const browser = await chromium.launch({ executablePath: chromePath(),
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, permissions: ['microphone'] });
const errors = [];
ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/500|404|401/.test(m.text())) errors.push(m.text()); }); });
await ctx.addInitScript((token) => {
  try { localStorage.setItem('synapse.token', token); } catch {}
  delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined });
  const fakeSynth = { getVoices: () => [], speak: (u) => setTimeout(() => u.onend && u.onend({}), 30), cancel() {}, speaking: false, onvoiceschanged: null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'speechSynthesis', { value: fakeSynth });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
}, TOKEN);
const noisyFlags = [];
await ctx.route('**/api/transcribe', async (r) => {
  const body = r.request().postDataBuffer()?.toString('latin1') ?? '';
  noisyFlags.push(/name="noisy"\r\n\r\n1/.test(body));
  await r.fulfill({ json: { text: 'Hmm.', engine: 'mock' } });
});
const wav = fs.readFileSync(WAV);
await ctx.route('**/api/tts', (r) => r.fulfill({ status: 200, headers: { 'Content-Type': 'audio/wav' }, body: wav.subarray(0, 44 + 16000 * 2) }));
await ctx.route('**/api/health', (r) => r.fulfill({ json: { ok: true, hasKey: true, keyStatus: 'ok', keyMessage: '', keyHint: '', hasWorkspace: false, stt: true, tts: true } }));
await ctx.route('**/api/chat', (r) => r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: 'data: {"type":"text","text":"Sorry, say that again?"}\n\ndata: {"type":"done","stopReason":"end_turn","model":"m"}\n\n' }));
await ctx.route('**/api/translate', (r) => r.fulfill({ json: { ja: 'え？' } }));
await fetch('http://127.0.0.1:8787/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ sttEngine: 'server', ttsEngine: 'browser', uiLang: 'en', micMode: 'continuous', micSensitivity: 'low', immersion: 'high', silenceSec: 1.0 }) });
const page = await ctx.newPage();
page.on('console', (m) => { if (/\[vad\]/.test(m.text())) console.log(m.text()); });
page.on('response', (res) => { if (res.status() >= 400 || /transcribe/.test(res.url())) console.log('RESP', res.status(), res.url()); });
page.on('request', (rq) => { if (/transcribe/.test(rq.url())) console.log('REQ', rq.method(), rq.url()); });
await page.goto('http://127.0.0.1:5173/talk');
await page.waitForTimeout(1200);
await page.click('text=Start talking');
let fell = false;
for (let i = 0; i < 150; i++) {
  const b = await page.textContent('body');
  if (/switched to tap-to-talk/.test(b)) { fell = true; break; }
  await page.waitForTimeout(300);
}
const body = await page.textContent('body');
const turns = (body.match(/Hmm\./g) || []).length;
console.log('fell back to tap-to-talk:', fell, '| weak turns seen:', turns, '| uploads:', noisyFlags.length, '| noisy flag on every upload:', noisyFlags.length > 0 && noisyFlags.every(Boolean));
await page.screenshot({ path: `${OUT}/70-noise-fallback.png`, fullPage: true });
// With the mic now waiting for a tap, no more uploads should arrive by themselves.
const before = noisyFlags.length;
await page.waitForTimeout(5000);
console.log('uploads after fallback (expect 0):', noisyFlags.length - before, '| mic button shows tap hint:', /Tap → speak|Tap the mic/i.test(await page.textContent('body')));
console.log('errors:', errors);
await fetch('http://127.0.0.1:8787/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ micMode: 'auto', micSensitivity: 'normal' }) });
await browser.close();
