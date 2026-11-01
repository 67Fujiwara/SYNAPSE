// Scenes beyond the Talk page: offline, bad token, shadowing, review + word popup, Japanese UI, settings persistence.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
/** CHROME_PATH, or the Chromium that Playwright keeps under PLAYWRIGHT_BROWSERS_PATH (default /opt/pw-browsers). */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const d = fs.readdirSync(base).find((x) => x.startsWith('chromium-'));
  return `${base}/${d}/chrome-linux/chrome`;
}
const [OUT, TOKEN, ONLY] = [process.argv[2], process.argv[3], process.argv[4]];
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const API = 'http://127.0.0.1:8787';
const WEB = 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const findings = [];
const note = (scene, ok, msg) => { findings.push({ scene, ok, msg }); console.log(`${ok ? '  ok ' : '  BUG'} [${scene}] ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function putSettings(patch) { await fetch(`${API}/api/settings`, { method: 'PUT', headers: H, body: JSON.stringify(patch) }); }
async function sessionsCount() { return (await (await fetch(`${API}/api/sessions?limit=200`, { headers: H })).json()).length; }

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const errors = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/500|501|404|401|429|ERR_INTERNET|Failed to fetch/.test(m.text())) errors.push(m.text()); }); });
  await ctx.addInitScript(({ token, ttsMs, localSettings }) => {
    try { localStorage.setItem('synapse.token', token); if (localSettings) localStorage.setItem('synapse.settings', JSON.stringify(localSettings)); } catch {}
    window.__ttsMs = ttsMs; window.__spoken = []; window.__recStarts = 0;
    class FakeRec extends EventTarget {
      constructor() { super(); window.__rec = this; }
      start() { window.__recStarts++; this.__on = true; setTimeout(() => this.onstart && this.onstart(new Event('s')), 0); }
      stop() { this.__on = false; this.onend && this.onend(new Event('e')); }
      abort() { this.__on = false; this.onend && this.onend(new Event('e')); }
    }
    window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
    window.__emit = (text, isFinal) => { const r = window.__rec; if (!r || !r.onresult || !r.__on) return false; if (isFinal === false && r.onspeechstart) r.onspeechstart(new Event('x')); r.onresult({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text, confidence: 0.9 }, length: 1 }] }); if (isFinal && r.onspeechend) r.onspeechend(new Event('y')); return true; };
    const fakeSynth = { getVoices: () => [], speak: (u) => { window.__spoken.push(u.text); setTimeout(() => { u.onstart && u.onstart({}); }, 5); setTimeout(() => { u.onend && u.onend({}); }, window.__ttsMs); }, cancel() {}, speaking: false, onvoiceschanged: null, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(window, 'speechSynthesis', { value: fakeSynth });
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  }, { token: opts.token ?? TOKEN, ttsMs: opts.ttsMs ?? 30, localSettings: opts.localSettings ?? null });
  if (!opts.realApi) {
    await ctx.route('**/api/chat', async (r) => r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: 'data: {"type":"text","text":"Nice. "}\n\ndata: {"type":"text","text":"What else happened?"}\n\ndata: {"type":"done","stopReason":"end_turn","model":"m"}\n\n' }));
    await ctx.route('**/api/translate', (r) => r.fulfill({ json: { ja: '（訳）' } }));
    await ctx.route('**/api/review', (r) => r.fulfill({ json: { id: 'r' + Date.now(), sessionId: JSON.parse(r.request().postData()).sessionId, corrections: [{ original: 'I go there yesterday', fixed: 'I went there yesterday', reason: 'Past tense.', tag: 'grammar' }], betterPhrases: ['Let me double-check.', 'That works for me.', "I'll get back to you."], wins: ['Clear structure.'], termNotes: [], createdAt: new Date().toISOString() } }));
    await ctx.route('**/api/reviews?*', async (r) => { const sessions = await (await fetch(`${API}/api/sessions?limit=1`, { headers: H })).json(); const sId = sessions[0]?.id ?? 'x'; await r.fulfill({ json: [{ review: { id: 'r1', sessionId: sId, corrections: [{ original: 'I go there yesterday', fixed: 'I went there yesterday', reason: 'Past tense.', tag: 'grammar' }], betterPhrases: ['Let me double-check.'], wins: ['Clear.'], termNotes: [], createdAt: new Date().toISOString() }, session: { id: sId, mode: 'daily', endedAt: new Date().toISOString(), words: 8, speakingSec: 5 } }] }); });
    await ctx.route('**/api/word', (r) => r.fulfill({ json: { word: 'happened', ipa: '/ˈhæpənd/', pos: 'verb', definition: 'took place', ja: '起きた', example: 'It happened yesterday.' } }));
    await ctx.route('**/api/health', (r) => r.fulfill({ json: { ok: true, hasKey: true, keyStatus: 'ok', keyMessage: '', keyHint: '', hasWorkspace: false, stt: true, tts: false } }));
  }
  const page = await ctx.newPage();
  const phase = async () => page.getAttribute('[data-phase]', 'data-phase');
  const waitPhase = async (p, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await phase()) === p) return true; await sleep(50); } return false; };
  const userCount = async () => page.evaluate(() => document.querySelectorAll('[data-role="user"]').length);
  const exchange = async (text) => { const prev = await userCount(); await page.evaluate((t) => window.__emit(t, true), text); const t0 = Date.now(); while (Date.now() - t0 < 5000 && (await userCount()) <= prev) await sleep(50); while (Date.now() - t0 < 12000) { const p = await phase(); if (p === 'listening' || p === 'ready') return true; await sleep(50); } return false; };
  return { ctx, page, errors, phase, waitPhase, exchange };
}

const scenes = [];
const scene = (name, fn) => scenes.push({ name, fn });

// A. Commuter: loses the network mid-session; the session is queued and syncs when the network is back.
scene('offline', async () => {
  const s = await open();
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 0.6, manualSend: false, uiLang: 'en' });
  await s.page.goto(`${WEB}/talk`);
  await s.page.click('text=Start talking');
  await s.waitPhase('listening');
  note('offline', await s.exchange('I am on the train and the signal is bad'), 'first exchange online');
  await s.ctx.setOffline(true);
  await s.page.evaluate(() => window.__emit('now the tunnel', true));
  await sleep(1500);
  note('offline', (await s.phase()) === 'listening', `offline reply failed but the mic came back (phase ${await s.phase()})`);
  const n0 = await sessionsCount();
  await s.page.click('text=End session');
  await s.page.waitForSelector('text=Session complete');
  await sleep(800);
  const body = await s.page.textContent('body');
  note('offline', /queued|saved on this device|Saved locally|sync/i.test(body), `summary says the session is queued (${body.match(/queued[^.]*|saved[^.]*/i)?.[0]})`);
  note('offline', (await sessionsCount()) === n0, 'nothing reached the server while offline');
  await s.page.evaluate(() => { history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await sleep(1200);
  note('offline', /Offline|waiting to sync/.test(await s.page.textContent('body').catch(() => '')), 'dashboard shows offline / pending');
  await s.ctx.setOffline(false);
  await s.page.goto(`${WEB}/`);
  await sleep(2500);
  note('offline', (await sessionsCount()) === n0 + 1, 'queued session synced once online');
  note('offline', !/waiting to sync/.test(await s.page.textContent('body')), 'pending notice gone after sync');
  note('offline', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// B. Wrong token: every API call is 401; the app says so instead of hanging.
scene('bad-token', async () => {
  // Settings cannot load with a bad token, so the browser engine is pinned through the local copy.
  const s = await open({ token: 'wrong-token', realApi: true, localSettings: { sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', silenceSec: 0.6, uiLang: 'en' } });
  await s.page.goto(`${WEB}/settings`);
  await s.page.click('button:has-text("Test connection")');
  await sleep(1500);
  note('bad-token', /unauthorized|401|token/i.test(await s.page.textContent('body')), 'settings test reports the bad token');
  await s.page.goto(`${WEB}/talk`);
  await s.page.click('text=Start talking');
  await s.waitPhase('listening');
  await s.page.evaluate(() => window.__emit('Is anyone there', true));
  await sleep(2500);
  note('bad-token', (await s.phase()) === 'listening', `mic back after the 401 reply (phase ${await s.phase()})`);
  note('bad-token', /unauthorized/i.test(await s.page.textContent('body')), `error names the auth problem (${(await s.page.textContent('body')).match(/[^\n]{0,60}(error|unauthor|401)[^\n]{0,60}/i)?.[0]})`);
  await s.page.click('text=End session');
  await s.page.waitForSelector('text=Session complete');
  await sleep(800);
  note('bad-token', /Saved locally/i.test(await s.page.textContent('body')), `summary shows the session was kept locally (${(await s.page.textContent('body')).match(/Saved[^\n]{0,40}/)?.[0]})`);
  note('bad-token', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// C. Shadowing persona: bank -> Listen -> Shadow (score) -> Recall -> next; attempt saved.
scene('shadowing', async () => {
  const s = await open({ ttsMs: 200 });
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', uiLang: 'en', silenceSec: 0.6 });
  await s.page.goto(`${WEB}/shadow`);
  await s.page.waitForSelector('h1:has-text("Shadow")');
  await s.page.click('button:has-text("Daily")');
  await sleep(800);
  await s.page.click('button:has-text("Practice")');
  await s.page.waitForSelector('text=Listen');
  const sentence = (await s.page.locator('.card.min-h-\\[120px\\] p').first().textContent()).trim();
  note('shadowing', sentence.length > 5, `practice shows a sentence (${sentence.slice(0, 30)})`);
  await s.page.click('button:has-text("Play")');
  await sleep(600);
  note('shadowing', (await s.page.evaluate(() => window.__spoken.length)) >= 1, 'Listen plays the sentence');
  await s.page.click('button:has-text("Shadow")');
  await s.page.click('button:has-text("Speak")');
  await sleep(300);
  await s.page.evaluate((t) => window.__emit(t, true), sentence);
  await s.page.waitForSelector('text=Score', { timeout: 8000 });
  const body = await s.page.textContent('body');
  const score = Number(body.match(/(\d+)%/)?.[1] ?? -1);
  note('shadowing', score >= 90, `shadow score for a perfect repeat (${score}%)`);
  await s.page.click('button:has-text("Next")');
  await sleep(400);
  await s.page.click('button:has-text("Recall")');
  note('shadowing', /Say it from memory|hidden|from memory/i.test(await s.page.textContent('body')) || (await s.page.locator('text=Speak').count()) > 0, 'recall hides the sentence');
  await s.page.click('button:has-text("Speak")');
  await sleep(300);
  await s.page.evaluate(() => window.__emit('completely different words here', true));
  await s.page.waitForSelector('text=Score', { timeout: 8000 });
  const low = Number((await s.page.textContent('body')).match(/(\d+)%/)?.[1] ?? -1);
  note('shadowing', low < 50, `wrong recall scores low (${low}%)`);
  const items = await (await fetch(`${API}/api/shadow/items`, { headers: H })).json();
  note('shadowing', items.some((i) => i.attempts > 0), 'attempts persisted');
  note('shadowing', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// D. Reviewer: after a talk, the word popup works, the review shows corrections, and one can be sent to shadowing.
scene('review-word', async () => {
  const s = await open();
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 0.6, manualSend: false, uiLang: 'en' });
  await s.page.goto(`${WEB}/talk`);
  await s.page.click('text=Start talking');
  await s.waitPhase('listening');
  await s.exchange('I go there yesterday and check the panel');
  await s.page.locator('[data-role="ai"]').last().locator('button', { hasText: 'happened' }).first().click();
  await sleep(600);
  note('review-word', /ˈhæpənd|起きた/.test(await s.page.textContent('body')), 'word popup shows IPA and Japanese');
  await s.page.keyboard.press('Escape');
  await s.page.click('text=End session');
  await s.page.waitForSelector('text=Session complete');
  await sleep(1200);
  note('review-word', /I went there yesterday/.test(await s.page.textContent('body')), 'review correction shown on the summary');
  await s.page.goto(`${WEB}/review`);
  await s.page.waitForSelector('text=Review');
  await sleep(800);
  const first = s.page.locator('button:has-text("· daily ·")').first();
  if (await first.count()) await first.click();
  await sleep(600);
  const add = s.page.locator('button:has-text("Add to shadowing")').first();
  note('review-word', (await add.count()) > 0, 'review page lists the correction with Add to shadowing');
  if (await add.count()) { await add.click(); await sleep(500); const items = await (await fetch(`${API}/api/shadow/items`, { headers: H })).json(); note('review-word', items.some((i) => /I went there yesterday/.test(i.text)), 'correction added to the deck'); }
  note('review-word', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// E. Japanese UI persona: whole talk flow with uiLang ja.
scene('japanese-ui', async () => {
  const s = await open();
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'low', silenceSec: 0.6, manualSend: false, uiLang: 'ja' });
  await s.page.goto(`${WEB}/talk`);
  await s.page.waitForSelector('text=話し始める');
  await s.page.click('text=話し始める');
  await s.waitPhase('listening');
  note('japanese-ui', await s.exchange('Today I fixed the conveyor'), 'exchange in Japanese UI');
  await sleep(400);
  note('japanese-ui', (await s.page.locator('text=（訳）').count()) >= 1, 'subtitles under AI lines (low immersion)');
  await s.page.click('text=終了');
  await s.page.waitForSelector('text=セッション完了');
  note('japanese-ui', true, 'summary in Japanese');
  await s.page.click('text=もう一度話す');
  await s.page.waitForSelector('text=話し始める');
  note('japanese-ui', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await putSettings({ uiLang: 'en' });
  await s.ctx.close();
});

// F. Settings persona: a changed setting survives a reload and is what the Talk page uses.
scene('settings-persist', async () => {
  const s = await open();
  await putSettings({ micSensitivity: 'normal', micMode: 'auto', uiLang: 'en' });
  await s.page.goto(`${WEB}/settings`);
  await s.page.waitForSelector('text=Mic sensitivity');
  const sel = (label) => s.page.locator(`.text-sm.font-medium:text-is("${label}")`).locator('xpath=../..').locator('select');
  await sel('Mic sensitivity').selectOption('low');
  await sel('Mic mode').selectOption('push');
  await sleep(1200);
  await s.page.reload();
  await s.page.waitForSelector('text=Mic sensitivity');
  note('settings-persist', (await sel('Mic sensitivity').inputValue()) === 'low', 'mic sensitivity persisted');
  const server = await (await fetch(`${API}/api/settings`, { headers: H })).json();
  note('settings-persist', server.micSensitivity === 'low' && server.micMode === 'push', `server copy updated (${server.micSensitivity}, ${server.micMode})`);
  await s.page.goto(`${WEB}/talk`);
  await s.page.click('text=Start talking');
  note('settings-persist', await s.waitPhase('ready', 8000), 'push mode from settings applies on desktop');
  await s.page.click('text=End session');
  await putSettings({ micSensitivity: 'normal', micMode: 'auto' });
  note('settings-persist', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

const list = ONLY ? scenes.filter((x) => ONLY.split(',').includes(x.name)) : scenes;
for (const sc of list) { console.log(`== ${sc.name}`); try { await sc.fn(); } catch (e) { note(sc.name, false, `threw: ${e.message.split('\n')[0]}`); } }
await putSettings({ sttEngine: 'server', ttsEngine: 'server', micMode: 'auto', immersion: 'high', manualSend: false, silenceSec: 1.2, uiLang: 'en', micSensitivity: 'normal' });
const bugs = findings.filter((f) => !f.ok);
console.log(`\n${findings.length - bugs.length} ok, ${bugs.length} bugs`);
await browser.close();
