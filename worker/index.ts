import { Hono } from 'hono';
import { cors } from 'hono/cors';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Env } from './env';
import type { ChatEvent, ChatRequest, NewInstantItem, NewShadowItem, Review, SessionPayload, Settings, ShadowMode, WordInfo } from '../shared/types';
import { buildChatSystem, INSTANT_SYSTEM, REVIEW_SYSTEM, SCENARIO_GENERATOR_SYSTEM, TRANSLATE_SYSTEM, WORD_SYSTEM } from './prompts';
import { getReview, listReviews, saveReview } from './db/reviews';
import { addItems, deleteItem, listItems, recordAttempt } from './db/shadow';
import { addBonusXp, addInstantItems, deleteInstantItem, instantMaterials, listInstantItems, recordInstantAttempt } from './db/instant';
import { levelSpec, LEVELS, type InstantLevel } from '../shared/instant';
import { completeMission, getProgress } from './db/progress';
import { exportAll, importAll } from './db/transfer';
import { findRecording, listRecordings, purgeRecordings, putRecording, recordingKey } from './db/recordings';
import type { ExportBundle } from '../shared/types';
import { looksHallucinated, lowConfidence } from '../shared/hallucination';
import { AURA_VOICE_IDS } from '../shared/voices';
import { deleteAll, getSession, listSessions, saveSession } from './db/sessions';
import { getStats } from './db/stats';
import { getSettings, putSettings } from './db/settings';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type', 'X-Local-Date'] }));

// --- Auth: a single shared bearer token (personal app). ----------------------
app.use('/api/*', async (c, next) => {
  const expected = c.env.APP_TOKEN;
  if (!expected) return c.json({ error: 'APP_TOKEN is not configured on the Worker' }, 500);
  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!timingSafeEqual(token, expected)) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function anthropic(env: Env) {
  // User-scoped keys (sk-ant-usr-…) must say which workspace to bill; the header does that.
  const ws = env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    defaultHeaders: ws ? { 'anthropic-workspace-id': ws } : undefined,
  });
}

function needsWorkspace(err: unknown): boolean {
  return err instanceof Anthropic.BadRequestError && /workspace/i.test(err.message);
}

/** Local calendar date sent by the client (its time zone), else UTC today. */
function localDate(c: { req: { header(name: string): string | undefined } }): string {
  const h = c.req.header('X-Local-Date');
  return h && /^\d{4}-\d{2}-\d{2}$/.test(h) ? h : new Date().toISOString().slice(0, 10);
}

// Health: also verifies the Anthropic key with a free call (models.list costs no tokens),
// so "Test connection" in Settings tells the user exactly which half is broken.
app.get('/api/health', async (c) => {
  const key = c.env.ANTHROPIC_API_KEY ?? '';
  const hasKey = Boolean(key);
  let keyStatus: 'ok' | 'missing' | 'invalid' | 'workspace' | 'error' = hasKey ? 'ok' : 'missing';
  let keyMessage = '';
  if (hasKey) {
    try {
      // count_tokens is free and goes through the same checks a real message does
      // (auth, workspace scoping), unlike models.list which passes for any key.
      await anthropic(c.env).messages.countTokens({
        model: c.env.DEFAULT_CHAT_MODEL || 'claude-sonnet-5-5',
        messages: [{ role: 'user', content: 'hi' }],
      });
    } catch (err) {
      keyStatus = err instanceof Anthropic.AuthenticationError ? 'invalid' : needsWorkspace(err) ? 'workspace' : 'error';
      keyMessage = describeError(err);
    }
  }
  const hint = hasKey ? `${key.slice(0, 10)}…${key.slice(-4)} (${key.length} chars)` : '';
  return c.json({
    ok: true,
    hasKey,
    keyStatus,
    keyMessage,
    keyHint: hint,
    hasWorkspace: Boolean(c.env.ANTHROPIC_WORKSPACE_ID),
    stt: Boolean(c.env.AI || c.env.STT_API_KEY),
    tts: Boolean(c.env.AI),
  });
});

// --- Chat: streams Claude's reply as SSE without buffering. -----------------
app.post('/api/chat', async (c) => {
  const body = (await c.req.json()) as ChatRequest;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: 'messages required' }, 400);
  }
  const model = body.model || c.env.DEFAULT_CHAT_MODEL || 'claude-sonnet-5-5';
  const system = buildChatSystem(body.mode ?? 'free', body.immersion ?? 'high', body.scenario);
  // Keep only the recent window; a spoken session rarely needs more context.
  const messages = body.messages.slice(-40).map((m) => ({ role: m.role, content: m.content }));

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const send = (ev: ChatEvent) => writer.write(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));

  const client = anthropic(c.env);
  const run = async () => {
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: 400, // 2–3 spoken sentences; a hard cap keeps replies short.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
        // Fast replies matter more than deep reasoning in a voice chat.
        output_config: { effort: 'low' },
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          await send({ type: 'text', text: event.delta.text });
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') {
        await send({ type: 'text', text: "Let's talk about something else. What's on your plate at work this week?" });
      }
      await send({ type: 'done', stopReason: final.stop_reason, model: final.model });
    } catch (err) {
      await send({ type: 'error', message: describeError(err) });
    } finally {
      await writer.close();
    }
  };
  c.executionCtx.waitUntil(run());

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic API key is invalid (check ANTHROPIC_API_KEY).';
  if (needsWorkspace(err))
    return 'This API key needs a workspace: set ANTHROPIC_WORKSPACE_ID on the Worker (Console → Settings → Workspaces), or create a workspace-scoped key.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API. Try again in a moment.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API.';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

// --- My Work: turn a 1–3 line project description into a scenario. -----------
app.post('/api/scenario', async (c) => {
  const { description, model } = (await c.req.json()) as { description: string; model?: string };
  if (!description?.trim()) return c.json({ error: 'description required' }, 400);
  const client = anthropic(c.env);
  const res = await client.messages.create({
    model: model || c.env.DEFAULT_CHAT_MODEL || 'claude-sonnet-5-5',
    max_tokens: 600,
    system: SCENARIO_GENERATOR_SYSTEM,
    messages: [{ role: 'user', content: description.trim() }],
    output_config: { effort: 'low' },
  });
  if (res.stop_reason === 'refusal') return c.json({ error: 'Could not build a scenario from that description.' }, 422);
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return c.json({ scenario: text });
});

// --- Text-to-speech (Deepgram Aura 2 on Workers AI), cached in R2 -------------------
app.post('/api/tts', async (c) => {
  if (!c.env.AI) return c.json({ error: 'Server TTS is not configured (Workers AI binding).' }, 501);
  const { text, voice } = (await c.req.json()) as { text?: string; voice?: string };
  const t = (text ?? '').trim().slice(0, 1000);
  if (!t) return c.json({ error: 'text required' }, 400);
  const speaker = voice && AURA_VOICE_IDS.has(voice) ? voice : 'luna';

  const key = `tts-cache/${await sha256(`${speaker}|${t}`)}.mp3`;
  if (c.env.BUCKET) {
    try {
      const hit = await c.env.BUCKET.get(key);
      if (hit) return new Response(hit.body, { headers: { 'Content-Type': 'audio/mpeg', 'X-TTS-Cache': 'hit', 'Cache-Control': 'private, max-age=86400' } });
    } catch {
      /* no bucket */
    }
  }

  const out = (await c.env.AI.run('@cf/deepgram/aura-2-en', { text: t, speaker, encoding: 'mp3' } as never)) as unknown;
  let bytes: ArrayBuffer;
  if (out instanceof ReadableStream) bytes = await new Response(out).arrayBuffer();
  else if (out instanceof ArrayBuffer) bytes = out;
  else if (typeof out === 'string') bytes = Uint8Array.from(atob(out), (ch) => ch.charCodeAt(0)).buffer;
  else if (out && typeof out === 'object' && 'audio' in out && typeof (out as { audio: unknown }).audio === 'string')
    bytes = Uint8Array.from(atob((out as { audio: string }).audio), (ch) => ch.charCodeAt(0)).buffer;
  else return c.json({ error: 'Unexpected TTS output' }, 502);

  if (c.env.BUCKET) c.executionCtx.waitUntil(c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'audio/mpeg' } }).catch(() => {}));
  return new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg', 'X-TTS-Cache': 'miss', 'Cache-Control': 'private, max-age=86400' } });
});

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Japanese subtitle for one AI line (immersion Medium/Low) ------------------
app.post('/api/translate', async (c) => {
  const { text } = (await c.req.json()) as { text?: string };
  if (!text?.trim()) return c.json({ error: 'text required' }, 400);
  const client = anthropic(c.env);
  const res = await client.messages.create({
    model: c.env.DEFAULT_TRANSLATE_MODEL || 'claude-haiku-5-5',
    max_tokens: 400,
    system: [{ type: 'text', text: TRANSLATE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: text.trim().slice(0, 1200) }],
    output_config: { effort: 'low' },
  });
  if (res.stop_reason === 'refusal') return c.json({ ja: '' });
  const ja = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return c.json({ ja });
});

// --- Server-side speech-to-text (optional) -------------------------------------
// Fallback for browsers whose SpeechRecognition is unreliable (iOS Safari).
// The client records a short clip (MediaRecorder) and posts it here; we forward
// it to an OpenAI-compatible /audio/transcriptions endpoint and return the text.
const WHISPER_PROMPT =
  'Casual conversation between engineers about electrical and controls work: control panel, terminal block, PLC, HMI, VFD, servo drive, E-stop, interlock, commissioning, FAT, drawing revision.';

app.post('/api/transcribe', async (c) => {
  if (!c.env.AI && !c.env.STT_API_KEY) return c.json({ error: 'Server speech-to-text is not configured (Workers AI binding or STT_API_KEY).' }, 501);
  const form = await c.req.formData();
  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) return c.json({ error: 'audio file required' }, 400);
  if (audio.size > 20 * 1024 * 1024) return c.json({ error: 'audio too large (max 20MB)' }, 413);
  // The AI's last line. Whisper decodes much better when it knows the question being answered.
  const context = String(form.get('context') ?? '').slice(0, 300);
  const prompt = context ? `${WHISPER_PROMPT} The other person just said: "${context}"` : WHISPER_PROMPT;

  // 1) Workers AI Whisper (default): free tier, no key, runs on Cloudflare.
  if (c.env.AI) {
    try {
      const bytes = new Uint8Array(await audio.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const out = (await c.env.AI.run('@cf/openai/whisper-large-v3-turbo', {
        audio: btoa(bin),
        task: 'transcribe',
        language: 'en',
        vad_filter: true,
        initial_prompt: prompt,
        beam_size: 5,
        condition_on_previous_text: false,
      })) as { text?: string; segments?: { no_speech_prob?: number; avg_logprob?: number }[] };
      const text = (out.text ?? '').trim();
      // Whisper invents subtitle boilerplate on clips without speech: drop those.
      if (!text || looksHallucinated(text) || lowConfidence(out.segments)) {
        return c.json({ text: '', engine: 'workers-ai', dropped: text || '(empty)', bytes: audio.size });
      }
      return c.json({ text, engine: 'workers-ai', bytes: audio.size, type: audio.type });
    } catch (err) {
      if (!c.env.STT_API_KEY) return c.json({ error: `Workers AI transcription failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
      // fall through to the external API
    }
  }

  // 2) Any OpenAI-compatible /audio/transcriptions API (STT_API_KEY).
  const upstream = new FormData();
  const ext = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : audio.type.includes('wav') ? 'wav' : 'webm';
  upstream.append('file', audio, `speech.${ext}`);
  upstream.append('model', c.env.STT_MODEL || 'whisper-1');
  upstream.append('language', 'en');
  upstream.append('prompt', prompt);
  upstream.append('response_format', 'json');
  const base = (c.env.STT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${c.env.STT_API_KEY}` }, body: upstream });
  if (!res.ok) return c.json({ error: `Speech-to-text failed (${res.status}): ${(await res.text()).slice(0, 300)}` }, 502);
  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? '').trim();
  if (!text || looksHallucinated(text)) return c.json({ text: '', engine: 'external', dropped: text || '(empty)' });
  return c.json({ text, engine: 'external' });
});

// --- Review (Phase 2): post-session corrections with the accurate model ----------
const ReviewSchema = z.object({
  corrections: z
    .array(
      z.object({
        original: z.string(),
        fixed: z.string(),
        reason: z.string(),
        tag: z.enum(['grammar', 'vocabulary', 'natural', 'term']),
      }),
    )
    .max(8),
  betterPhrases: z.array(z.string()).max(3),
  wins: z.array(z.string()).max(2),
  termNotes: z.array(z.object({ heard: z.string(), standard: z.string(), note: z.string() })).max(5),
});

app.post('/api/review', async (c) => {
  const body = (await c.req.json()) as { sessionId: string; turns: { role: 'user' | 'ai'; text: string }[]; model?: string };
  if (!body.sessionId || !Array.isArray(body.turns)) return c.json({ error: 'sessionId and turns required' }, 400);
  const userLines = body.turns.filter((t) => t.role === 'user' && t.text.trim());
  if (userLines.length === 0) return c.json({ error: 'nothing to review' }, 422);

  const transcript = body.turns
    .slice(-80)
    .map((t) => `${t.role === 'user' ? 'You' : 'AI'}: ${t.text.trim()}`)
    .join('\n');

  const client = anthropic(c.env);
  const res = await client.messages.parse({
    model: body.model || c.env.DEFAULT_REVIEW_MODEL || 'claude-opus-5-5',
    max_tokens: 4000,
    system: [{ type: 'text', text: REVIEW_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Transcript:\n${transcript}` }],
    output_config: { format: zodOutputFormat(ReviewSchema), effort: 'medium' },
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) return c.json({ error: 'Review could not be generated.' }, 502);

  const review: Review = {
    id: crypto.randomUUID(),
    sessionId: body.sessionId,
    ...res.parsed_output,
    createdAt: new Date().toISOString(),
  };
  await saveReview(c.env.DB, review);
  return c.json(review);
});

app.get('/api/reviews', async (c) => {
  const limit = Math.min(100, Number(c.req.query('limit') ?? 20) || 20);
  return c.json(await listReviews(c.env.DB, limit));
});

app.get('/api/review/:sessionId', async (c) => {
  const r = await getReview(c.env.DB, c.req.param('sessionId'));
  return r ? c.json(r) : c.json({ error: 'not found' }, 404);
});

// --- Word popup (Phase 2) ---------------------------------------------------------
const WordSchema = z.object({
  word: z.string(),
  ipa: z.string(),
  pos: z.string(),
  definition: z.string(),
  ja: z.string(),
  example: z.string(),
});

app.post('/api/word', async (c) => {
  const { word, context } = (await c.req.json()) as { word?: string; context?: string };
  if (!word?.trim()) return c.json({ error: 'word required' }, 400);
  const client = anthropic(c.env);
  const res = await client.messages.parse({
    model: c.env.DEFAULT_TRANSLATE_MODEL || 'claude-haiku-5-5',
    max_tokens: 400,
    system: [{ type: 'text', text: WORD_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Word: ${word.trim().slice(0, 60)}\nSentence: ${(context ?? '').trim().slice(0, 400)}` }],
    output_config: { format: zodOutputFormat(WordSchema), effort: 'low' },
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) return c.json({ error: 'No entry.' }, 502);
  return c.json(res.parsed_output satisfies WordInfo);
});

// --- Shadowing deck (Phase 2) ------------------------------------------------------
app.get('/api/shadow/items', async (c) => c.json(await listItems(c.env.DB)));

app.post('/api/shadow/items', async (c) => {
  const { items } = (await c.req.json()) as { items: NewShadowItem[] };
  if (!Array.isArray(items) || items.length === 0) return c.json({ error: 'items required' }, 400);
  const clean = items.slice(0, 200).filter((i) => typeof i.text === 'string' && i.text.trim().length > 0 && i.text.length <= 400);
  const ids = clean.map(() => crypto.randomUUID());
  return c.json(await addItems(c.env.DB, clean, ids, new Date().toISOString()));
});

app.delete('/api/shadow/items/:id', async (c) => {
  await deleteItem(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

app.post('/api/shadow/attempts', async (c) => {
  const b = (await c.req.json()) as { itemId: string; score: number; wpm: number; speed: number; mode: ShadowMode };
  if (!b.itemId || typeof b.score !== 'number') return c.json({ error: 'itemId and score required' }, 400);
  const item = await recordAttempt(c.env.DB, {
    id: crypto.randomUUID(),
    itemId: b.itemId,
    at: new Date().toISOString(),
    score: Math.max(0, Math.min(100, Math.round(b.score))),
    wpm: Number(b.wpm) || 0,
    speed: Number(b.speed) || 1,
    mode: b.mode ?? 'shadow',
    durationSec: Number((b as { durationSec?: number }).durationSec) || 0,
  });
  return item ? c.json(item) : c.json({ error: 'not found' }, 404);
});

// --- Instant composition (Phase 4) -------------------------------------------------
const CUE_KINDS = ['sentence', 'transform', 'situation'] as const;
function isLevel(n: unknown): n is InstantLevel {
  return typeof n === 'number' && LEVELS.some((l) => l.level === n);
}

app.get('/api/instant/items', async (c) => {
  const lv = Number(c.req.query('level'));
  return c.json(await listInstantItems(c.env.DB, isLevel(lv) ? lv : undefined));
});

app.post('/api/instant/items', async (c) => {
  const { items } = (await c.req.json()) as { items: NewInstantItem[] };
  if (!Array.isArray(items) || items.length === 0) return c.json({ error: 'items required' }, 400);
  const clean = items
    .slice(0, 200)
    .filter((i) => isLevel(i.level) && CUE_KINDS.includes(i.cueKind) && typeof i.cue === 'string' && typeof i.answer === 'string' && i.answer.trim() && i.answer.length <= 400 && i.cue.length <= 400)
    .map((i) => ({ ...i, source: i.source === 'ai' ? 'ai' : i.source === 'manual' ? 'manual' : 'bank' }) as NewInstantItem);
  const ids = clean.map(() => crypto.randomUUID());
  return c.json(await addInstantItems(c.env.DB, clean, ids, new Date().toISOString()));
});

app.delete('/api/instant/items/:id', async (c) => {
  await deleteInstantItem(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

const InstantSchema = z.object({
  items: z
    .array(
      z.object({
        cue: z.string(),
        transform: z.string().nullable(),
        answer: z.string(),
        alternatives: z.array(z.string()).max(3),
        keywords: z.array(z.string()).max(4),
        hint: z.string(),
        topic: z.string(),
      }),
    )
    .max(15),
});

/** Generate a fresh set of drills for one level from the learner's own material. */
app.post('/api/instant/generate', async (c) => {
  const b = (await c.req.json()) as { level?: number; count?: number; focus?: string; model?: string };
  if (!isLevel(b.level)) return c.json({ error: 'level 1..5 required' }, 400);
  const spec = levelSpec(b.level);
  const count = Math.max(3, Math.min(15, Number(b.count) || 10));
  const m = await instantMaterials(c.env.DB, b.level);
  const lines = [
    `LEVEL ${spec.level}: ${spec.brief}`,
    `Cue kind: ${spec.cueKind}. Answer length: ${spec.words[0]}–${spec.words[1]} words. Produce exactly ${count} drills.`,
    b.focus?.trim() ? `Focus requested by the learner: ${b.focus.trim().slice(0, 300)}` : '',
    m.scenario ? `Learner's current project (My Work scenario):\n${m.scenario}` : '',
    m.fixes.length ? `Sentences a coach corrected for this learner (drill these patterns):\n- ${m.fixes.join('\n- ')}` : '',
    m.phrases.length ? `Phrases the coach suggested:\n- ${m.phrases.join('\n- ')}` : '',
    m.existing.length ? `Drills the learner already has at this level (do not repeat):\n- ${m.existing.join('\n- ')}` : '',
  ].filter(Boolean);
  const client = anthropic(c.env);
  let parsed: z.infer<typeof InstantSchema> | null = null;
  try {
    const res = await client.messages.parse({
      model: b.model || c.env.DEFAULT_CHAT_MODEL || 'claude-sonnet-5-5',
      max_tokens: 4000,
      system: [{ type: 'text', text: INSTANT_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: lines.join('\n\n') }],
      output_config: { format: zodOutputFormat(InstantSchema), effort: 'low' },
    });
    if (res.stop_reason !== 'refusal') parsed = res.parsed_output ?? null;
  } catch (e) {
    if (needsWorkspace(e)) return c.json({ error: 'The API key is user-scoped: set ANTHROPIC_WORKSPACE_ID on the Worker.' }, 502);
    throw e;
  }
  if (!parsed) return c.json({ error: 'Drills could not be generated.' }, 502);
  const items: NewInstantItem[] = parsed.items.map((it) => ({
    level: spec.level,
    cueKind: spec.cueKind,
    cue: it.cue,
    transform: spec.cueKind === 'transform' ? it.transform || null : null,
    answer: it.answer,
    alternatives: it.alternatives,
    keywords: spec.cueKind === 'situation' ? it.keywords : [],
    hint: it.hint || null,
    topic: it.topic || null,
    source: 'ai',
  }));
  const ids = items.map(() => crypto.randomUUID());
  return c.json(await addInstantItems(c.env.DB, items, ids, new Date().toISOString()));
});

const INSTANT_PASS_XP = 2;
app.post('/api/instant/attempts', async (c) => {
  const b = (await c.req.json()) as { itemId?: string; score?: number; latencySec?: number; heard?: string; passed?: boolean; timedOut?: boolean };
  if (!b.itemId || typeof b.score !== 'number') return c.json({ error: 'itemId and score required' }, 400);
  const passed = Boolean(b.passed);
  const item = await recordInstantAttempt(c.env.DB, {
    id: crypto.randomUUID(),
    itemId: b.itemId,
    at: new Date().toISOString(),
    score: Math.max(0, Math.min(100, Math.round(b.score))),
    latencySec: Math.max(0, Math.round((Number(b.latencySec) || 0) * 100) / 100),
    heard: typeof b.heard === 'string' ? b.heard : '',
    passed,
    timedOut: Boolean(b.timedOut),
  });
  if (!item) return c.json({ error: 'not found' }, 404);
  if (passed) await addBonusXp(c.env.DB, localDate(c), INSTANT_PASS_XP);
  return c.json({ item, bonusXp: passed ? INSTANT_PASS_XP : 0 });
});

// --- Progress / missions (Phase 3) -------------------------------------------------
app.get('/api/progress', async (c) => c.json(await getProgress(c.env.DB, localDate(c))));

const MISSION_BONUS_XP = 20;
app.post('/api/missions/done', async (c) => {
  const newly = await completeMission(c.env.DB, localDate(c), MISSION_BONUS_XP);
  return c.json({ ok: true, newly, bonusXp: newly ? MISSION_BONUS_XP : 0 });
});

// --- Export / import (Phase 3) --------------------------------------------------------
app.get('/api/export', async (c) => {
  const bundle = await exportAll(c.env.DB);
  // Keep a copy in R2 when the bucket is bound (best effort).
  if (c.env.BUCKET) {
    try {
      await c.env.BUCKET.put(`exports/${bundle.exportedAt.slice(0, 10)}.json`, JSON.stringify(bundle), { httpMetadata: { contentType: 'application/json' } });
    } catch {
      /* no bucket / quota */
    }
  }
  return c.json(bundle);
});

app.post('/api/import', async (c) => {
  const bundle = (await c.req.json()) as ExportBundle;
  if (bundle?.version !== 1) return c.json({ error: 'unsupported export version' }, 400);
  return c.json(await importAll(c.env.DB, bundle));
});

// --- Recordings (Phase 3): the learner's own clips, stored in R2 ---------------------
app.post('/api/recordings', async (c) => {
  if (!c.env.BUCKET) return c.json({ error: 'R2 bucket not configured' }, 501);
  const form = await c.req.formData();
  const audio = form.get('audio');
  const turnId = String(form.get('turnId') ?? '');
  const sessionId = String(form.get('sessionId') ?? '');
  const durationSec = Number(form.get('durationSec') ?? 0) || 0;
  if (!(audio instanceof File) || !turnId || !sessionId) return c.json({ error: 'audio, turnId, sessionId required' }, 400);
  if (audio.size > 20 * 1024 * 1024) return c.json({ error: 'too large' }, 413);
  const contentType = audio.type || 'audio/webm';
  const key = recordingKey(sessionId, turnId, contentType);
  await putRecording(c.env.DB, c.env.BUCKET, { id: crypto.randomUUID(), turnId, sessionId, durationSec, contentType, createdAt: new Date().toISOString() }, key, await audio.arrayBuffer());
  return c.json({ ok: true, turnId });
});

app.get('/api/recordings', async (c) => {
  const sessionId = c.req.query('sessionId');
  if (!sessionId) return c.json({ error: 'sessionId required' }, 400);
  return c.json(await listRecordings(c.env.DB, sessionId));
});

app.get('/api/recordings/:turnId', async (c) => {
  if (!c.env.BUCKET) return c.json({ error: 'R2 bucket not configured' }, 501);
  const rec = await findRecording(c.env.DB, c.req.param('turnId'));
  if (!rec) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.BUCKET.get(rec.key);
  if (!obj) return c.json({ error: 'gone' }, 404);
  return new Response(obj.body, { headers: { 'Content-Type': rec.contentType, 'Cache-Control': 'private, max-age=3600' } });
});

// --- Sessions ----------------------------------------------------------------
app.post('/api/sessions', async (c) => {
  const payload = (await c.req.json()) as SessionPayload;
  if (!payload?.session?.id) return c.json({ error: 'session.id required' }, 400);
  await saveSession(c.env.DB, payload, localDate(c));
  return c.json({ ok: true, id: payload.session.id });
});

app.get('/api/sessions', async (c) => {
  const limit = Math.min(100, Number(c.req.query('limit') ?? 20) || 20);
  return c.json(await listSessions(c.env.DB, limit));
});

app.get('/api/sessions/:id', async (c) => {
  const s = await getSession(c.env.DB, c.req.param('id'));
  return s ? c.json(s) : c.json({ error: 'not found' }, 404);
});

// --- Stats -------------------------------------------------------------------
app.get('/api/stats', async (c) => {
  const days = Math.min(400, Number(c.req.query('days') ?? 7) || 7);
  return c.json(await getStats(c.env.DB, localDate(c), days));
});

// --- Settings ----------------------------------------------------------------
app.get('/api/settings', async (c) => c.json(await getSettings(c.env.DB)));
app.put('/api/settings', async (c) => {
  const patch = (await c.req.json()) as Partial<Settings>;
  return c.json(await putSettings(c.env.DB, patch));
});

// --- Data management ---------------------------------------------------------
app.delete('/api/data', async (c) => {
  await deleteAll(c.env.DB);
  return c.json({ ok: true });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default {
  fetch: app.fetch,
  /** Nightly: delete recordings older than the configured retention. */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (!env.BUCKET) return;
    ctx.waitUntil(
      (async () => {
        const settings = await getSettings(env.DB);
        await purgeRecordings(env.DB, env.BUCKET!, Math.max(1, settings.recordingDays || 30));
      })(),
    );
  },
};
