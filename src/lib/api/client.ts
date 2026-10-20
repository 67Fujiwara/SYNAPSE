import type { ChatEvent, ChatRequest, ExportBundle, InstantItem, NewInstantItem, NewShadowItem, ProgressResponse, RecordingMeta, Review, ReviewSummary, SessionPayload, Settings, ShadowItem, ShadowMode, StatsResponse, Turn, WordInfo } from '@shared/types';
import { localDate } from '../util';

const TOKEN_KEY = 'synapse.token';

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}
export function setToken(t: string) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* private mode */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function headers(json = true): HeadersInit {
  const h: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
    'X-Local-Date': localDate(),
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () =>
    request<{ ok: boolean; hasKey: boolean; keyStatus: 'ok' | 'missing' | 'invalid' | 'workspace' | 'error'; keyMessage: string; keyHint: string; hasWorkspace: boolean; stt: boolean; tts: boolean }>(
      '/api/health',
    ),
  stats: (days = 7) => request<StatsResponse>(`/api/stats?days=${days}`),
  saveSession: (payload: SessionPayload) =>
    request<{ ok: boolean }>('/api/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  getSettings: () => request<Settings>('/api/settings'),
  putSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  scenario: (description: string, model?: string) =>
    request<{ scenario: string }>('/api/scenario', { method: 'POST', body: JSON.stringify({ description, model }) }),
  deleteAll: () => request<{ ok: boolean }>('/api/data', { method: 'DELETE' }),
  translate: (text: string) => request<{ ja: string }>('/api/translate', { method: 'POST', body: JSON.stringify({ text }) }),
  // Phase 2
  review: (sessionId: string, turns: Pick<Turn, 'role' | 'text'>[], model?: string) =>
    request<Review>('/api/review', { method: 'POST', body: JSON.stringify({ sessionId, turns, model }) }),
  reviews: (limit = 20) => request<ReviewSummary[]>(`/api/reviews?limit=${limit}`),
  reviewOf: (sessionId: string) => request<Review>(`/api/review/${encodeURIComponent(sessionId)}`),
  sessions: (limit = 30) => request<import('@shared/types').Session[]>(`/api/sessions?limit=${limit}`),
  session: (id: string) => request<SessionPayload>(`/api/sessions/${encodeURIComponent(id)}`),
  word: (word: string, context: string) => request<WordInfo>('/api/word', { method: 'POST', body: JSON.stringify({ word, context }) }),
  shadowItems: () => request<ShadowItem[]>('/api/shadow/items'),
  addShadowItems: (items: NewShadowItem[]) => request<ShadowItem[]>('/api/shadow/items', { method: 'POST', body: JSON.stringify({ items }) }),
  deleteShadowItem: (id: string) => request<{ ok: boolean }>(`/api/shadow/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  shadowAttempt: (a: { itemId: string; score: number; wpm: number; speed: number; mode: ShadowMode; durationSec: number }) =>
    request<ShadowItem>('/api/shadow/attempts', { method: 'POST', body: JSON.stringify(a) }),
  /** Synthesize one sentence on the Worker (Deepgram Aura). Returns an audio/mpeg blob. */
  tts: async (text: string, voice: string): Promise<Blob> => {
    const res = await fetch('/api/tts', { method: 'POST', headers: headers(), body: JSON.stringify({ text, voice }) });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.blob();
  },
  // Phase 4
  instantItems: (level?: number) => request<InstantItem[]>(`/api/instant/items${level ? `?level=${level}` : ''}`),
  addInstantItems: (items: NewInstantItem[]) => request<InstantItem[]>('/api/instant/items', { method: 'POST', body: JSON.stringify({ items }) }),
  generateInstant: (level: number, count = 10, focus?: string) =>
    request<InstantItem[]>('/api/instant/generate', { method: 'POST', body: JSON.stringify({ level, count, focus }) }),
  deleteInstantItem: (id: string) => request<{ ok: boolean }>(`/api/instant/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  instantAttempt: (a: { itemId: string; score: number; latencySec: number; heard: string; passed: boolean; timedOut: boolean }) =>
    request<{ item: InstantItem; bonusXp: number }>('/api/instant/attempts', { method: 'POST', body: JSON.stringify(a) }),
  // Phase 3
  progress: () => request<ProgressResponse>('/api/progress'),
  missionDone: () => request<{ ok: boolean; newly: boolean; bonusXp: number }>('/api/missions/done', { method: 'POST', body: '{}' }),
  exportAll: () => request<ExportBundle>('/api/export'),
  importAll: (bundle: ExportBundle) =>
    request<{ sessions: number; reviews: number; items: number; attempts: number }>('/api/import', { method: 'POST', body: JSON.stringify(bundle) }),
  recordings: (sessionId: string) => request<RecordingMeta[]>(`/api/recordings?sessionId=${encodeURIComponent(sessionId)}`),
  uploadRecording: async (blob: Blob, turnId: string, sessionId: string, durationSec: number) => {
    const form = new FormData();
    form.append('audio', blob, 'clip');
    form.append('turnId', turnId);
    form.append('sessionId', sessionId);
    form.append('durationSec', String(durationSec));
    const res = await fetch('/api/recordings', { method: 'POST', headers: headers(false), body: form });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
  },
  /** Fetch a recording as an object URL (the endpoint needs the auth header, so no plain <audio src>). */
  recordingUrl: async (turnId: string): Promise<string> => {
    const res = await fetch(`/api/recordings/${encodeURIComponent(turnId)}`, { headers: headers(false) });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return URL.createObjectURL(await res.blob());
  },
  /** Upload a recorded clip; resolves to the transcript. */
  transcribe: async (blob: Blob, context = ''): Promise<string> => {
    const form = new FormData();
    form.append('audio', blob, 'speech');
    if (context) form.append('context', context);
    const res = await fetch('/api/transcribe', { method: 'POST', headers: headers(false), body: form });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) msg = body.error;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, msg);
    }
    return ((await res.json()) as { text: string }).text;
  },
};

/**
 * Stream a chat reply. Calls onEvent for each SSE event as it arrives.
 * Resolves when the stream ends; rejects on transport/auth errors.
 */
export async function streamChat(
  req: ChatRequest,
  onEvent: (ev: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        let ev: ChatEvent | null = null;
        try {
          ev = JSON.parse(line.slice(6)) as ChatEvent;
        } catch {
          /* skip malformed frame */
        }
        if (ev) onEvent(ev); // errors thrown by the handler must propagate
      }
    }
  }
}
