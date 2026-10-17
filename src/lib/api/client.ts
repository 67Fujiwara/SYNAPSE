import type { ChatEvent, ChatRequest, SessionPayload, Settings, StatsResponse } from '@shared/types';
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
  health: () => request<{ ok: boolean; hasKey: boolean }>('/api/health'),
  stats: (days = 7) => request<StatsResponse>(`/api/stats?days=${days}`),
  saveSession: (payload: SessionPayload) =>
    request<{ ok: boolean }>('/api/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  getSettings: () => request<Settings>('/api/settings'),
  putSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  scenario: (description: string, model?: string) =>
    request<{ scenario: string }>('/api/scenario', { method: 'POST', body: JSON.stringify({ description, model }) }),
  deleteAll: () => request<{ ok: boolean }>('/api/data', { method: 'DELETE' }),
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
