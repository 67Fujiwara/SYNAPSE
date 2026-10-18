import { Hono } from 'hono';
import { cors } from 'hono/cors';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './env';
import type { ChatEvent, ChatRequest, SessionPayload, Settings } from '../shared/types';
import { buildChatSystem, SCENARIO_GENERATOR_SYSTEM } from './prompts';
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
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
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
  let keyStatus: 'ok' | 'missing' | 'invalid' | 'error' = hasKey ? 'ok' : 'missing';
  let keyMessage = '';
  if (hasKey) {
    try {
      await anthropic(c.env).models.list({ limit: 1 });
    } catch (err) {
      keyStatus = err instanceof Anthropic.AuthenticationError ? 'invalid' : 'error';
      keyMessage = describeError(err);
    }
  }
  const hint = hasKey ? `${key.slice(0, 10)}…${key.slice(-4)} (${key.length} chars)` : '';
  return c.json({ ok: true, hasKey, keyStatus, keyMessage, keyHint: hint, stt: Boolean(c.env.STT_API_KEY) });
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

// --- Server-side speech-to-text (optional) -------------------------------------
// Fallback for browsers whose SpeechRecognition is unreliable (iOS Safari).
// The client records a short clip (MediaRecorder) and posts it here; we forward
// it to an OpenAI-compatible /audio/transcriptions endpoint and return the text.
app.post('/api/transcribe', async (c) => {
  if (!c.env.STT_API_KEY) return c.json({ error: 'Server speech-to-text is not configured (STT_API_KEY).' }, 501);
  const form = await c.req.formData();
  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) return c.json({ error: 'audio file required' }, 400);
  if (audio.size > 20 * 1024 * 1024) return c.json({ error: 'audio too large (max 20MB)' }, 413);

  const upstream = new FormData();
  // Give the blob a filename with a sensible extension; some providers key the decoder on it.
  const ext = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : audio.type.includes('wav') ? 'wav' : 'webm';
  upstream.append('file', audio, `speech.${ext}`);
  upstream.append('model', c.env.STT_MODEL || 'whisper-1');
  upstream.append('language', 'en');
  upstream.append('response_format', 'json');

  const base = (c.env.STT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.STT_API_KEY}` },
    body: upstream,
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    return c.json({ error: `Speech-to-text failed (${res.status}): ${detail}` }, 502);
  }
  const data = (await res.json()) as { text?: string };
  return c.json({ text: (data.text ?? '').trim() });
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

export default app;
