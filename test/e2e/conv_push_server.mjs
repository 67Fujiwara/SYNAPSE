// iPhone's real path: push-to-talk + server recognizer with a fake mic. Tap -> speak -> auto-send -> reply -> ready.
// Then "tap, say nothing, tap" must come back to ready instead of hanging on "transcribing".
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: chromePath(),
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ permissions: ['microphone'], userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [];
ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/500|501|404|401/.test(m.text())) errors.push(m.text()); }); });
await ctx.addInitScript((token) => {
  try { localStorage.setItem('synapse.token', token); } catch {}
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined }); Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined });
  const fakeSynth = { getVoices: () => [], speak: (u) => setTimeout(() => u.onend && u.onend({}), 30), cancel() {}, speaking: false, onvoiceschanged: null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'speechSynthesis', { value: fakeSynth });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
}, TOKEN);
let uploads = 0;
await ctx.route('**/api/transcribe', async (r) => { uploads++; await sleep(300); await r.fulfill({ json: { text: 'I checked the wiring this morning.', engine: 'mock' } }); });
await ctx.route('**/api/chat', (r) => r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: 'data: {"type":"text","text":"Good. Anything wrong?"}\n\ndata: {"type":"done","stopReason":"end_turn","model":"m"}\n\n' }));
await ctx.route('**/api/translate', (r) => r.fulfill({ json: { ja: 'x' } }));
await ctx.route('**/api/health', (r) => r.fulfill({ json: { ok: true, hasKey: true, keyStatus: 'ok', keyMessage: '', keyHint: '', hasWorkspace: false, stt: true, tts: false } }));
await fetch('http://127.0.0.1:8787/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ sttEngine: 'server', ttsEngine: 'browser', uiLang: 'en', micMode: 'auto', micSensitivity: 'normal', immersion: 'high', silenceSec: 1.0 }) });
const page = await ctx.newPage();
const phase = () => page.getAttribute('[data-phase]', 'data-phase');
const waitPhase = async (p, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await phase()) === p) return true; await sleep(50); } return false; };
await page.goto('http://127.0.0.1:5173/talk');
await page.click('text=Start talking');
console.log('ready after opener (push on iPhone):', await waitPhase('ready'));
const mic = page.locator('button:has(svg.lucide-mic)').last();
await mic.click();
console.log('tap -> listening:', await waitPhase('listening', 3000));
// The fake mic bursts arrive by themselves; VAD ends the clip, mock transcript, reply, back to ready.
const t0 = Date.now();
const okReady = await waitPhase('ready', 15000);
console.log('spoke -> auto-sent -> reply -> ready:', okReady, '| uploads', uploads, '| turns', await page.evaluate(() => document.querySelectorAll('[data-role="user"]').length), '| in', ((Date.now() - t0) / 1000).toFixed(1), 's');
// Tap, say nothing, tap again at once: the clip is empty, so no transcript ever comes.
await mic.click();
await waitPhase('listening', 3000);
await sleep(150);
await mic.click();
await sleep(1500);
const body = await page.textContent('body');
console.log('empty tap-tap -> back to ready:', (await phase()) === 'ready', '| not stuck on transcribing:', !/Transcribing/i.test(body), '| phase', await phase());
// A second real turn still works (mic stream was kept open between turns).
// (A tap that lands mid-burst captures only the tail, which is dropped as too short and returns to ready: tap again.)
const u0 = uploads;
let got = false;
for (let i = 0; i < 4 && !got; i++) { await mic.click(); await waitPhase('listening', 3000); await waitPhase('ready', 15000); got = uploads > u0; }
console.log('second turn uploaded and answered:', got, '| user turns', await page.evaluate(() => document.querySelectorAll('[data-role="user"]').length));
await page.click('text=End session');
await page.waitForSelector('text=Session complete');
console.log('errors:', errors);
await fetch('http://127.0.0.1:8787/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ ttsEngine: 'server' }) });
await browser.close();
