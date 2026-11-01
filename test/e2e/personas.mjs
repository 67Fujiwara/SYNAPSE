// Ten speakers, many scenes: drives the Talk page with a scripted fake SpeechRecognition / speechSynthesis
// and mocked AI endpoints, checking the conversation state machine and the saved session each time.
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
for (let i = 0; i < 60; i++) { try { await fetch(WEB); await fetch(`${API}/api/health`, { headers: H }); break; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

const findings = [];
const note = (scene, ok, msg) => { findings.push({ scene, ok, msg }); console.log(`${ok ? '  ok ' : '  BUG'} [${scene}] ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sessionsCount() { return (await (await fetch(`${API}/api/sessions?limit=200`, { headers: H })).json()).length; }
async function putSettings(patch) { await fetch(`${API}/api/settings`, { method: 'PUT', headers: H, body: JSON.stringify(patch) }); }

/** A fresh context: fake recognition + synthesis, mocked AI. `opts.chat` = reply text or async fn(body, n) (null = SSE error). */
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, ...(opts.iphone ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
  const errors = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/500|501|404|401|429/.test(m.text())) errors.push(m.text()); }); });
  await ctx.addInitScript(({ token, ttsMs, noBrowserStt }) => {
    try { localStorage.setItem('synapse.token', token); } catch {}
    window.__ttsMs = ttsMs; window.__spoken = []; window.__recStarts = 0; window.__cancelled = 0;
    class FakeRec extends EventTarget {
      constructor() { super(); window.__rec = this; }
      start() { window.__recStarts++; this.__on = true; setTimeout(() => this.onstart && this.onstart(new Event('s')), 0); }
      stop() { this.__on = false; this.onend && this.onend(new Event('e')); }
      abort() { this.__on = false; this.onend && this.onend(new Event('e')); }
    }
    if (noBrowserStt) { Object.defineProperty(window, 'SpeechRecognition', { value: undefined }); Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined }); }
    else { window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec; }
    window.__emit = (text, isFinal) => { const r = window.__rec; if (!r || !r.onresult || !r.__on) return false; if (isFinal === false && r.onspeechstart) r.onspeechstart(new Event('x')); r.onresult({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text, confidence: 0.9 }, length: 1 }] }); if (isFinal && r.onspeechend) r.onspeechend(new Event('y')); return true; };
    window.__recError = (code) => { const r = window.__rec; r && r.onerror && r.onerror({ error: code }); };
    window.__recEnd = () => { const r = window.__rec; if (r) { r.__on = false; r.onend && r.onend(new Event('e')); } };
    const fakeSynth = { getVoices: () => [], speak: (u) => { window.__spoken.push(u.text); u.__t = setTimeout(() => { u.onend && u.onend({}); }, window.__ttsMs); }, cancel() { window.__cancelled += 1; }, speaking: false, onvoiceschanged: null, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(window, 'speechSynthesis', { value: fakeSynth });
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('no mic'), { name: 'NotAllowedError' }); };
  }, { token: TOKEN, ttsMs: opts.ttsMs ?? 30, noBrowserStt: Boolean(opts.noBrowserStt) });
  const chats = [];
  await ctx.route('**/api/chat', async (r) => {
    const body = JSON.parse(r.request().postData());
    chats.push(body);
    if (opts.chatStatus) return r.fulfill({ status: opts.chatStatus, json: { error: opts.chatError ?? 'boom' } });
    const reply = typeof opts.chat === 'function' ? await opts.chat(body, chats.length) : (opts.chat ?? 'Nice. Tell me more about that. What happened next?');
    if (opts.chatDelayMs) await sleep(opts.chatDelayMs);
    if (reply === null) return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: 'data: {"type":"error","message":"model overloaded"}\n\n' });
    const parts = reply.split(/(?<=[.!?])\s+/);
    const frames = parts.map((p, i) => `data: ${JSON.stringify({ type: 'text', text: (i ? ' ' : '') + p })}\n\n`).join('') + 'data: {"type":"done","stopReason":"end_turn","model":"m"}\n\n';
    await r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: frames });
  });
  await ctx.route('**/api/translate', (r) => r.fulfill({ json: { ja: '（訳）' + JSON.parse(r.request().postData()).text.slice(0, 10) } }));
  await ctx.route('**/api/review', (r) => r.fulfill({ json: { id: 'r' + Date.now(), sessionId: JSON.parse(r.request().postData()).sessionId, corrections: [{ original: 'I go', fixed: 'I went', reason: 'past', tag: 'grammar' }], betterPhrases: ['a', 'b', 'c'], wins: ['Clear.'], termNotes: [], createdAt: new Date().toISOString() } }));
  await ctx.route('**/api/scenario', (r) => r.fulfill({ json: { scenario: 'You are at a vendor meeting about a delayed servo drive. Opening line: "Thanks for coming in. Where are we on the drive delivery?"' } }));
  await ctx.route('**/api/health', (r) => r.fulfill({ json: { ok: true, hasKey: true, keyStatus: 'ok', keyMessage: '', keyHint: '', hasWorkspace: false, stt: true, tts: false } }));
  const page = await ctx.newPage();
  const phase = async () => page.getAttribute('[data-phase]', 'data-phase');
  const waitPhase = async (p, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await phase()) === p) return true; await sleep(50); } return false; };
  const turns = async () => page.evaluate(() => [...document.querySelectorAll('[data-role]')].map((e) => ({ role: e.getAttribute('data-role'), text: e.getAttribute('data-text') })));
  const userCount = async () => (await turns()).filter((x) => x.role === 'user').length;
  const say = async (text, { finals = 1, gapMs = 120, interim = true } = {}) => {
    const words = text.split(' ');
    if (interim) { await page.evaluate((t) => window.__emit(t, false), words.slice(0, Math.max(1, Math.floor(words.length / 2))).join(' ')); await sleep(gapMs); }
    const per = Math.ceil(words.length / finals);
    for (let i = 0; i < finals; i++) { const chunk = words.slice(i * per, (i + 1) * per).join(' '); if (!chunk) break; const ok = await page.evaluate((t) => window.__emit(t, true), chunk); if (!ok) return false; await sleep(gapMs); }
    return true;
  };
  /** Until the AI is done with its turn (listening / ready). */
  const settled = async (ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const p = await phase(); if (p === 'listening' || p === 'ready') return p; await sleep(50); } return null; };
  /** Until the user turn count passes `prev` (auto-send after silence or a tap). */
  const sent = async (prev, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await userCount()) > prev) return true; await sleep(50); } return false; };
  const exchange = async (text, sayOpts) => { const prev = await userCount(); const ok = await say(text, sayOpts); if (!ok) return { ok: false, why: 'mic off' }; if (!(await sent(prev))) return { ok: false, why: 'not sent' }; const p = await settled(); return { ok: p !== null, why: p ? '' : 'never settled', phase: p }; };
  return { ctx, page, errors, chats, phase, waitPhase, turns, userCount, say, sent, settled, exchange };
}

async function startTalk(page, { mode = 'daily', query = '' } = {}) {
  await page.goto(`${WEB}/talk${query}`);
  await page.waitForSelector('text=Start talking');
  if (mode !== 'daily') await page.click(`button:has-text("${{ business: 'Business', mywork: 'My Work', free: 'Free' }[mode]}")`);
  await page.click('text=Start talking');
}
async function endSession(s) { await s.page.click('text=End session'); await s.page.waitForSelector('text=Session complete'); await sleep(900); }
const micButton = (page) => page.locator('button:has(svg.lucide-mic), button:has(svg.lucide-mic-off)').last();

const scenes = [];
const scene = (name, fn) => scenes.push({ name, fn });

// 1. Native fast talker: Chrome splits one utterance into several finals in quick succession -> ONE turn.
scene('native-fast', async () => {
  const s = await open();
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', uiLang: 'en', silenceSec: 1.0, manualSend: false, micSensitivity: 'normal' });
  await startTalk(s.page);
  note('native-fast', await s.waitPhase('listening'), 'listening after opener');
  const r = await s.exchange('So basically we had this issue with the servo drive where the parameter set got overwritten after the firmware update and nobody noticed until the line stopped', { finals: 3, gapMs: 150 });
  note('native-fast', r.ok, `exchange completed (${r.why})`);
  const t = await s.turns();
  const user = t.filter((x) => x.role === 'user');
  note('native-fast', user.length === 1, `one user turn from 3 finals (got ${user.length})`);
  note('native-fast', /servo drive.*line stopped/.test(user[0]?.text ?? ''), 'turn holds the whole sentence');
  note('native-fast', t.filter((x) => x.role === 'ai').length === 2, `opener + one reply (ai rows ${t.filter((x) => x.role === 'ai').length})`);
  const n0 = await sessionsCount();
  await endSession(s);
  note('native-fast', (await sessionsCount()) === n0 + 1, 'session saved');
  note('native-fast', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// 2. Non-native with a mid-sentence pause longer than silenceSec: the fragment is sent; speech during the AI's
//    turn is ignored (mic is off), the rest becomes the next turn. Medium immersion subtitles on tap.
scene('nonnative-pauses', async () => {
  const s = await open({ ttsMs: 300, chatDelayMs: 900 });
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'medium', silenceSec: 1.0, manualSend: false });
  await startTalk(s.page);
  await s.waitPhase('listening');
  await s.say('I think the, uh, terminal block');
  note('nonnative-pauses', await s.sent(0, 3000), 'fragment sent after the pause');
  const ph = await s.phase();
  note('nonnative-pauses', ph === 'thinking' || ph === 'speaking', `AI turn in progress (phase ${ph})`);
  const emitted = await s.page.evaluate(() => window.__emit('is wired wrong', true));
  note('nonnative-pauses', emitted === false, `speech during the AI turn is not captured (emitted=${emitted})`);
  await s.settled();
  const r = await s.exchange('is wired wrong I mean the second one', { finals: 2, gapMs: 300 });
  note('nonnative-pauses', r.ok, `second exchange (${r.why})`);
  const user = (await s.turns()).filter((x) => x.role === 'user');
  note('nonnative-pauses', user.length === 2, `two user turns (got ${user.length}: ${user.map((u) => u.text).join(' | ')})`);
  await sleep(400);
  const btn = s.page.locator('button[aria-pressed]').first();
  note('nonnative-pauses', (await btn.count()) > 0, 'subtitle toggle exists (medium)');
  if (await btn.count()) { await btn.click(); await sleep(200); note('nonnative-pauses', /（訳）/.test(await s.page.textContent('body')), 'subtitle shown after tap'); }
  await endSession(s);
  note('nonnative-pauses', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// 3. Filler-only speaker: local nudge, then a real sentence goes through normally.
scene('fillers', async () => {
  const s = await open();
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 1.0, manualSend: false });
  await startTalk(s.page);
  await s.waitPhase('listening');
  const chatsBefore = s.chats.length;
  await s.say('um uh えーと');
  note('fillers', await s.sent(0, 3000), 'filler turn sent');
  await s.settled();
  note('fillers', s.chats.length === chatsBefore, 'fillers did not hit the API (local nudge)');
  note('fillers', /Keep going/.test(await s.page.textContent('body')), 'nudge shown');
  const r = await s.exchange('Sorry. I was checking the drawing revision for the panel layout');
  note('fillers', r.ok && s.chats.length === chatsBefore + 1, `real sentence reached the API (${r.why})`);
  await endSession(s);
  note('fillers', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// 4. Interrupter: taps while the AI is thinking and while it is speaking.
scene('interrupter', async () => {
  const s = await open({ ttsMs: 1200, chatDelayMs: 1200, chat: 'First sentence here. Second sentence here. Third sentence here.' });
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 1.0, manualSend: false });
  await startTalk(s.page);
  await s.waitPhase('listening', 8000);
  await s.say('Can I ask you something about the interlock');
  note('interrupter', await s.waitPhase('thinking', 4000), 'thinking while the reply is delayed');
  await s.page.mouse.click(500, 300);
  note('interrupter', await s.waitPhase('listening', 3000), 'interrupt during thinking -> listening');
  await sleep(1500);
  note('interrupter', (await s.phase()) === 'listening', `still listening after the aborted reply would have arrived (phase ${await s.phase()})`);
  const cancelled0 = await s.page.evaluate(() => window.__cancelled);
  await s.say('Actually never mind. How do I say this in English');
  note('interrupter', await s.waitPhase('speaking', 8000), 'speaking');
  await sleep(300);
  await s.page.mouse.click(500, 300);
  note('interrupter', await s.waitPhase('listening', 3000), 'interrupt during speaking -> listening');
  note('interrupter', (await s.page.evaluate(() => window.__cancelled)) > cancelled0, 'TTS cancelled');
  await sleep(1600);
  note('interrupter', (await s.phase()) === 'listening', 'no phase flip after the cancelled TTS timer');
  const ai = (await s.turns()).filter((x) => x.role === 'ai');
  note('interrupter', ai.every((a) => a.text.trim().length > 0), 'no empty AI turns left behind');
  const r = await s.exchange('Okay one more normal exchange');
  note('interrupter', r.ok, `normal exchange after interrupts (${r.why})`);
  await endSession(s);
  note('interrupter', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// 5. iPhone push-to-talk: tap, speak (auto-send on silence or tap), taps at odd moments.
scene('iphone-push', async () => {
  const s = await open({ iphone: true, chatDelayMs: 800 });
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'auto', immersion: 'high', silenceSec: 1.0, manualSend: false });
  await startTalk(s.page);
  note('iphone-push', await s.waitPhase('ready', 8000), 'ready (push) after opener on iPhone');
  const mic = micButton(s.page);
  await mic.click();
  note('iphone-push', await s.waitPhase('listening', 3000), 'tap -> listening');
  const starts1 = await s.page.evaluate(() => window.__recStarts);
  await s.say('Good morning. I have a question about the lead time');
  await mic.click();
  note('iphone-push', await s.sent(0, 3000), 'tap sent the draft');
  note('iphone-push', await mic.isDisabled(), 'mic button disabled while the AI is thinking (a tap does nothing)');
  const p = await s.settled();
  note('iphone-push', p === 'ready', `back to ready after the reply (phase ${p})`);
  await mic.click(); await sleep(250); await mic.click(); await sleep(250);
  note('iphone-push', (await s.phase()) === 'ready', `tap twice with nothing said returns to ready (phase ${await s.phase()})`);
  await mic.click();
  await s.waitPhase('listening', 3000);
  await s.say('Two weeks is fine');
  note('iphone-push', await s.sent(1, 3000), 'silence auto-sends in push mode too');
  await s.settled();
  const user = (await s.turns()).filter((x) => x.role === 'user');
  note('iphone-push', user.length === 2, `two user turns (got ${user.length})`);
  const starts2 = await s.page.evaluate(() => window.__recStarts);
  note('iphone-push', starts2 - starts1 >= 2 && starts2 - starts1 <= 4, `mic started a sane number of times (${starts2 - starts1})`);
  await endSession(s);
  note('iphone-push', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// 6. Manual-send user (desktop, low immersion): Send is disabled when empty, nothing auto-sends, Send delivers.
scene('manual-send', async () => {
  const s = await open();
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'low', silenceSec: 1.0, manualSend: true });
  await startTalk(s.page);
  await s.waitPhase('listening');
  const chats0 = s.chats.length;
  const sendBtn = s.page.locator('button:has-text("Send")');
  note('manual-send', await sendBtn.isDisabled(), 'Send disabled with nothing to send');
  await s.say('The customer wants the FAT next Friday');
  await sleep(2000);
  note('manual-send', (await s.phase()) === 'listening' && s.chats.length === chats0, 'nothing auto-sent after silence (manual mode)');
  note('manual-send', !(await sendBtn.isDisabled()), 'Send enabled with a draft');
  await sendBtn.click();
  note('manual-send', await s.sent(0, 3000), 'Send delivered the draft');
  await s.settled();
  note('manual-send', s.chats.length === chats0 + 1, 'one chat call');
  await sleep(500);
  note('manual-send', (await s.page.locator('text=（訳）').count()) >= 1, 'low immersion: subtitles shown automatically');
  await endSession(s);
  note('manual-send', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// 7. API trouble: SSE error event, then HTTP 500 -> the mic comes back each time and End still saves.
scene('api-trouble', async () => {
  let n = 0;
  const s = await open({ chat: async () => (++n === 1 ? null : 'Back online. Go on.') });
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 1.0, manualSend: false });
  await startTalk(s.page);
  await s.waitPhase('listening');
  const r1 = await s.exchange('Testing the error path number one');
  note('api-trouble', r1.ok, `mic back after an SSE error event (${r1.why})`);
  note('api-trouble', /overloaded/.test(await s.page.textContent('body')), 'error text shown');
  const r2 = await s.exchange('And now a normal one');
  note('api-trouble', r2.ok, `normal exchange afterwards (${r2.why})`);
  const t = await s.turns();
  note('api-trouble', t.filter((x) => x.role === 'ai' && !x.text.trim()).length === 0, 'no empty AI turn from the failed reply');
  note('api-trouble', !/overloaded/.test(await s.page.textContent('body')), 'stale error cleared by the next successful turn');
  await endSession(s);
  await s.ctx.close();

  const s2 = await open({ chatStatus: 500, chatError: 'Internal' });
  await startTalk(s2.page);
  await s2.waitPhase('listening');
  const r3 = await s2.exchange('Server is down today');
  note('api-trouble', r3.ok, `mic back after HTTP 500 (${r3.why})`);
  const n0 = await sessionsCount();
  await endSession(s2);
  note('api-trouble', (await sessionsCount()) === n0 + 1, 'session with a failed reply still saved');
  note('api-trouble', s2.errors.length === 0, `no page errors ${JSON.stringify(s2.errors)}`);
  await s2.ctx.close();
});

// 8. Marathon: 30 quick exchanges, then the summary's numbers must be sane.
scene('marathon', async () => {
  const s = await open({ chat: 'Got it. And then?' });
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 0.5, manualSend: false });
  await startTalk(s.page, { mode: 'business' });
  await s.waitPhase('listening');
  const lines = ['We replaced the contactor', 'Then we checked the wiring harness', 'The HMI showed an alarm', 'I called the vendor about lead time', 'They promised two weeks', 'We updated the BOM', 'The customer approved the change order'];
  let failed = 0;
  for (let i = 0; i < 30; i++) { const r = await s.exchange(lines[i % lines.length] + ` number ${i + 1}`, { interim: false }); if (!r.ok) { failed++; note('marathon', false, `turn ${i + 1}: ${r.why} (phase ${await s.phase()})`); if (failed > 2) break; } }
  const user = (await s.turns()).filter((x) => x.role === 'user');
  note('marathon', user.length === 30, `30 user turns (got ${user.length})`);
  const last = s.chats.at(-1);
  note('marathon', last && last.messages.length === 60, `history grows as expected: opener + 30 user + 29 AI (${last?.messages.length} messages)`);
  await endSession(s);
  const body = await s.page.textContent('body');
  const wpm = Number(body.match(/(\d+)\s*wpm/i)?.[1] ?? body.match(/WPM\D*(\d+)/i)?.[1] ?? -1);
  note('marathon', wpm >= 0 && wpm <= 300, `WPM sane (${wpm})`);
  note('marathon', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// 9. Mission + My Work.
scene('mission-mywork', async () => {
  const s = await open();
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 1.0, manualSend: false });
  await startTalk(s.page, { query: '?mode=free&mission=' + encodeURIComponent('Explain what an interlock is in 3 sentences.') });
  await s.waitPhase('listening');
  const ai0 = (await s.turns()).find((x) => x.role === 'ai');
  note('mission-mywork', /mission/i.test(ai0?.text ?? ''), 'opener mentions the mission');
  const r = await s.exchange('An interlock is a safety circuit that stops the machine when a guard is open so that nobody can reach into moving parts while it runs and it must be reset by hand');
  note('mission-mywork', r.ok, `exchange (${r.why})`);
  await endSession(s);
  await sleep(600);
  note('mission-mywork', /Mission complete/.test(await s.page.textContent('body')), 'mission counted');
  await s.ctx.close();

  const s2 = await open();
  await s2.page.goto(`${WEB}/talk`);
  await s2.page.waitForSelector('text=Start talking');
  await s2.page.click('button:has-text("My Work")');
  await s2.page.fill('textarea', '搬送ラインのサーボ更新。ベンダーと納期調整中。');
  await s2.page.click('button:has-text("Build scenario")');
  await s2.page.waitForSelector('text=vendor meeting');
  await s2.page.click('text=Start talking');
  await s2.waitPhase('listening', 8000);
  const ai = (await s2.turns()).find((x) => x.role === 'ai');
  note('mission-mywork', /Where are we on the drive delivery/.test(ai?.text ?? ''), `My Work opener uses the scenario line`);
  note('mission-mywork', s2.chats.length === 0, 'no chat call before the learner speaks');
  const r2 = await s2.exchange('We are two weeks behind because of the drive');
  note('mission-mywork', r2.ok, `exchange (${r2.why})`);
  note('mission-mywork', /vendor meeting/.test(s2.chats[0]?.scenario ?? ''), `scenario sent with the chat (mode=${s2.chats[0]?.mode}, scenario=${String(s2.chats[0]?.scenario).slice(0, 40)})`);
  await endSession(s2);
  note('mission-mywork', s2.errors.length === 0, `no page errors ${JSON.stringify(s2.errors)}`);
  await s2.ctx.close();
});

// 10. Quitter: ends while the AI is thinking; a pending draft at End must not be lost; a second session is clean.
scene('quitter', async () => {
  const s = await open({ ttsMs: 1500, chatDelayMs: 600, chat: 'One. Two. Three. Four.' });
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 1.0, manualSend: false });
  await startTalk(s.page);
  await s.waitPhase('listening');
  await s.say('Quick question before I go');
  await s.sent(0, 3000);
  note('quitter', (await s.phase()) === 'thinking', 'thinking');
  await s.page.click('text=End session');
  await s.page.waitForSelector('text=Session complete');
  await sleep(2500);
  note('quitter', (await s.page.locator('text=Session complete').count()) === 1, 'summary stays after the aborted reply/TTS would have finished');
  const starts = await s.page.evaluate(() => window.__recStarts);
  await sleep(1500);
  note('quitter', (await s.page.evaluate(() => window.__recStarts)) === starts, 'mic not restarted after End');
  await s.page.click('text=Talk again');
  await s.page.waitForSelector('text=Start talking');
  await s.page.click('text=Start talking');
  note('quitter', await s.waitPhase('listening', 8000), 'second session starts cleanly');
  const r = await s.exchange('Hello again this is the second session');
  note('quitter', r.ok, `exchange (${r.why})`);
  const user = (await s.turns()).filter((x) => x.role === 'user');
  note('quitter', user.length === 1, `second session has only its own turns (got ${user.length}: ${user.map((u) => u.text).join(' | ')})`);
  await s.say('These last words were never sent');
  await sleep(200);
  const n0 = await sessionsCount();
  await endSession(s);
  const sessions = await (await fetch(`${API}/api/sessions?limit=1`, { headers: H })).json();
  const full = await (await fetch(`${API}/api/sessions/${sessions[0].id}`, { headers: H })).json();
  note('quitter', (await sessionsCount()) === n0 + 1, 'second session saved');
  note('quitter', full.turns.some((t) => /never sent/.test(t.text)), `pending draft kept as the last turn (turns: ${full.turns.map((t) => t.text.slice(0, 20)).join(' | ')})`);
  note('quitter', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// 11. Browser recognition hiccups: 'no-speech', 'network', an unexpected end, empty finals, odd text.
scene('recognition-hiccups', async () => {
  const s = await open();
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 1.0, manualSend: false });
  await startTalk(s.page);
  await s.waitPhase('listening');
  await s.page.evaluate(() => window.__recError('no-speech'));
  await s.page.evaluate(() => window.__recEnd());
  await sleep(600);
  note('recognition-hiccups', (await s.phase()) === 'listening' && (await s.page.evaluate(() => window.__rec.__on)), 'restarted after no-speech + end');
  await s.page.evaluate(() => window.__recError('network'));
  await s.page.evaluate(() => window.__recEnd());
  await sleep(600);
  note('recognition-hiccups', /network/i.test(await s.page.textContent('body')), 'network error shown');
  note('recognition-hiccups', await s.page.evaluate(() => window.__rec.__on), 'mic restarted after network error');
  const r = await s.exchange('Still here and talking');
  note('recognition-hiccups', r.ok, `speech still gets through (${r.why})`);
  note('recognition-hiccups', !/network/i.test(await s.page.textContent('body')), 'network error cleared once things work again');
  await s.page.evaluate(() => window.__emit('', true));
  await s.page.evaluate(() => window.__emit('   ', true));
  await sleep(1500);
  note('recognition-hiccups', (await s.phase()) === 'listening' && (await s.userCount()) === 1, 'empty finals do not send');
  const r2 = await s.exchange('Mixed 制御盤 wording with emoji 🙂 and a verylongwordwithoutspaces');
  note('recognition-hiccups', r2.ok, `odd text exchange (${r2.why})`);
  await endSession(s);
  note('recognition-hiccups', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// 12. No browser recognition and no mic permission (first-time phone user): clear message, nothing crashes.
scene('no-mic', async () => {
  const s = await open({ noBrowserStt: true });
  await putSettings({ sttEngine: 'server', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 1.0, manualSend: false });
  await startTalk(s.page);
  await s.waitPhase('listening', 6000);
  await sleep(1500);
  note('no-mic', /Microphone access was denied/.test(await s.page.textContent('body')), 'mic denied message shown');
  await endSession(s);
  note('no-mic', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

// 13. Noise fallback then a real tap: after the forced switch the learner can still talk by tapping.
scene('noise-then-tap', async () => {
  const s = await open({ chat: 'Hm? Say again?' });
  await putSettings({ sttEngine: 'browser', ttsEngine: 'browser', micMode: 'continuous', immersion: 'high', silenceSec: 0.5, manualSend: false });
  await startTalk(s.page);
  await s.waitPhase('listening');
  for (const w of ['you', 'hmm', 'okay']) { const r = await s.exchange(w, { interim: false }); if (!r.ok) note('noise-then-tap', false, `weak turn ${w}: ${r.why}`); }
  note('noise-then-tap', /tap-to-talk/.test(await s.page.textContent('body')), 'fallback notice shown after 3 weak turns');
  note('noise-then-tap', (await s.phase()) === 'ready', `waiting for a tap (phase ${await s.phase()})`);
  await micButton(s.page).click();
  note('noise-then-tap', await s.waitPhase('listening', 3000), 'tap -> listening');
  const r = await s.exchange('Sorry it is noisy here but I am back now');
  note('noise-then-tap', r.ok && r.phase === 'ready', `real turn works and returns to ready (${r.why} ${r.phase})`);
  await endSession(s);
  note('noise-then-tap', s.errors.length === 0, `no page errors ${JSON.stringify(s.errors)}`);
  await s.ctx.close();
});

const list = ONLY ? scenes.filter((x) => ONLY.split(',').includes(x.name)) : scenes;
for (const sc of list) {
  console.log(`== ${sc.name}`);
  try { await sc.fn(); } catch (e) { note(sc.name, false, `threw: ${e.message.split('\n')[0]}`); }
}
await putSettings({ sttEngine: 'server', ttsEngine: 'server', micMode: 'auto', immersion: 'high', manualSend: false, silenceSec: 1.2, uiLang: 'en' });
const bugs = findings.filter((f) => !f.ok);
console.log(`\n${findings.length - bugs.length} ok, ${bugs.length} bugs`);
await browser.close();
