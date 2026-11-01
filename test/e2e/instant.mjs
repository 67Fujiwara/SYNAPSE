import { chromium } from 'playwright-core';
import fs from 'node:fs';
/** CHROME_PATH, or the Chromium that Playwright keeps under PLAYWRIGHT_BROWSERS_PATH (default /opt/pw-browsers). */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const d = fs.readdirSync(base).find((x) => x.startsWith('chromium-'));
  return `${base}/${d}/chrome-linux/chrome`;
}
const OUT = process.argv[2];
const TOKEN = 'dev-token-123';
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const errors = [];
ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/500|404|401/.test(m.text())) errors.push(m.text()); }); });
await ctx.addInitScript((token) => {
  try { localStorage.setItem('synapse.token', token); } catch {}
  class FakeRec extends EventTarget { constructor() { super(); window.__rec = this; } start() { setTimeout(() => this.onstart && this.onstart(new Event('s')), 0); } stop() { this.onend && this.onend(new Event('e')); } abort() { this.onend && this.onend(new Event('e')); } }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
  window.__emit = (text, isFinal) => { const r = window.__rec; if (!r || !r.onresult) return; if (isFinal === false && r.onspeechstart) r.onspeechstart(new Event('x')); r.onresult({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text, confidence: 0.9 }, length: 1 }] }); };
  const fakeSynth = { getVoices: () => [], speak: (u) => setTimeout(() => u.onend && u.onend({}), 30), cancel() {}, speaking: false, onvoiceschanged: null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'speechSynthesis', { value: fakeSynth });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
}, TOKEN);
await ctx.route('**/api/instant/generate', (r) => r.fulfill({ json: [
  { id: 'g1', level: 3, cueKind: 'sentence', cue: '生成された文です。', transform: null, answer: 'This is a generated sentence.', alternatives: [], keywords: [], hint: null, topic: 'work', source: 'ai', dueAt: null, intervalDays: 0, bestScore: 0, bestLatency: null, masteredCount: 0, attempts: 0, createdAt: new Date().toISOString() },
  { id: 'g2', level: 3, cueKind: 'sentence', cue: 'もう 1 つ。', transform: null, answer: 'One more sentence here.', alternatives: [], keywords: [], hint: null, topic: 'work', source: 'ai', dueAt: null, intervalDays: 0, bestScore: 0, bestLatency: null, masteredCount: 0, attempts: 0, createdAt: new Date().toISOString() },
] }));
await fetch('http://127.0.0.1:8787/api/settings', { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sttEngine: 'browser', ttsEngine: 'browser', uiLang: 'en', silenceSec: 1.0 }) });
const items = await (await fetch('http://127.0.0.1:8787/api/instant/items?level=1', { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const byCue = new Map(items.map((i) => [i.cue, i.answer.replace(/\.$/, '')]));
const page = await ctx.newPage();

await page.goto('http://127.0.0.1:5173/instant');
await page.waitForSelector('text=Instant composition');
await page.waitForTimeout(600);
let body = await page.textContent('body');
console.log('levels shown:', (body.match(/Lv[1-5]/g) || []).length >= 5, '| Lv1 start disabled:', await page.locator('button:has-text("Start")').first().isDisabled());
await page.screenshot({ path: `${OUT}/50-levels.png`, fullPage: true });

// Add starter set to level 1
await page.locator('button:has-text("Drills")').first().click();
await page.locator('button:has-text("Add starter set")').click();
await page.waitForSelector('text=/Added 10 drills|Nothing new to add/');
body = await page.textContent('body');
console.log('counts after starter:', body.match(/\d+ due · \d+ drills · \d+ automatic/)?.[0]);

// Start level 1
await page.locator('button:has-text("Start")').first().click();
await page.waitForSelector('text=Japanese → English');
await page.waitForTimeout(400);
const cue = await page.textContent('.font-display.text-2xl.font-medium');
const ans = byCue.get(cue.trim()) ?? 'I have two meetings today';
console.log('cue 1:', cue, '->', ans);
await page.screenshot({ path: `${OUT}/51-cue.png` });
// Speak after ~0.8s
await page.waitForTimeout(800);
await page.evaluate((a) => window.__emit(a.split(' ').slice(0, 2).join(' '), false), ans);
await page.waitForTimeout(200);
await page.evaluate((a) => window.__emit(a, true), ans);
await page.waitForSelector('text=Repeat the model answer');
body = await page.textContent('body');
console.log('result 1:', body.match(/(\d+)%/)?.[0], '| latency', body.match(/(\d\.\d)s/)?.[0], '| fast badge', /fast/.test(body));
await page.screenshot({ path: `${OUT}/52-result.png`, fullPage: true });
// Repeat x3 -> auto next
for (let i = 0; i < 3; i++) { await page.waitForTimeout(250); await page.evaluate((a) => window.__emit(a, true), ans); }
body = await page.textContent('body');
console.log('repeat log lines:', (await page.locator('ul li:has-text("' + ans.slice(0, 12) + '")').count()));
await page.waitForTimeout(1200);
body = await page.textContent('body');
console.log('auto-advanced to 2/10:', /2 \/ 10/.test(body));
// Let item 2 time out (6 s)
await page.waitForTimeout(6600);
body = await page.textContent('body');
console.log("timeout shown:", /Time's up/.test(body), '| hint shown', (await page.locator('.bg-surface-2.px-3.py-2').count()) > 0);
await page.screenshot({ path: `${OUT}/53-timeout.png`, fullPage: true });
await page.keyboard.press('Space');
await page.waitForTimeout(300);
body = await page.textContent('body');
console.log('space -> 3/10:', /3 \/ 10/.test(body));
// Skip the rest
for (let i = 0; i < 8; i++) { await page.locator('button:has-text("Skip")').click(); await page.waitForTimeout(250); if (i < 7) { await page.locator('button:has-text("Next")').click(); await page.waitForTimeout(250); } }
await page.locator('button:has-text("Finish")').click();
await page.waitForSelector('text=Round complete');
body = await page.textContent('body');
console.log('summary:', body.match(/(\d+)\/10/)?.[0], 'passed |', /\+2 XP/.test(body) ? 'xp ok' : 'no xp');
await page.screenshot({ path: `${OUT}/54-summary.png`, fullPage: true });
await page.locator('button:has-text("Back to levels")').click();
await page.waitForSelector('text=Instant composition');
body = await page.textContent('body');
console.log('level 1 counts after round:', body.match(/\d+ due · 10 drills · \d+ automatic/)?.[0]);

// AI generate on level 3 (mocked)
await page.locator('button:has-text("Drills")').nth(2).click();
await page.locator('button:has-text("Make 10 with AI")').click();
await page.waitForSelector('text=Added 2 drills');
console.log('generate: added 2, listed:', /This is a generated sentence/.test(await page.textContent('body')));

// Progress page + dashboard
await page.goto('http://127.0.0.1:5173/progress');
await page.waitForSelector('text=Time to first word');
body = await page.textContent('body');
console.log('progress: instant card', /Pass rate/.test(body), '| per-level', (body.match(/Lv\d/g) || []).length >= 5);
await page.screenshot({ path: `${OUT}/55-progress.png`, fullPage: true });
await page.goto('http://127.0.0.1:5173/');
await page.waitForSelector('text=Instant');
await page.waitForTimeout(800);
body = await page.textContent('body');
console.log('dashboard card:', body.match(/\d+ drills due today|Japanese cue → say it in seconds/)?.[0]);
// Japanese UI
await fetch('http://127.0.0.1:8787/api/settings', { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ uiLang: 'ja' }) });
await page.goto('http://127.0.0.1:5173/instant');
await page.waitForTimeout(1200);
body = await page.textContent('body');
console.log('ja ui:', /瞬間英作文/.test(body), /文型の切り替え/.test(body));
await page.screenshot({ path: `${OUT}/56-levels-ja.png`, fullPage: true });
await fetch('http://127.0.0.1:8787/api/settings', { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ uiLang: 'en', sttEngine: 'server', ttsEngine: 'server' }) });
console.log('page errors:', errors);
await browser.close();
