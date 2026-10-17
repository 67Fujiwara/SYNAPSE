import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, Immersion, Mode, Session, SessionPayload, Turn } from '@shared/types';
import { streamChat } from '@/lib/api/client';
import { WebSpeechRecognizer } from '@/lib/speech/recognition';
import { WebSpeechSynthesizer } from '@/lib/speech/synthesis';
import { SentenceChunker } from '@/lib/speech/sentences';
import { computeMetrics, computeXp } from '@/lib/metrics';
import { uuid } from '@/lib/util';

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'ended';

export interface DisplayTurn {
  id: string;
  role: 'user' | 'ai';
  text: string;
  startedAt: string;
  endedAt: string;
  streaming?: boolean;
}

export interface ConversationConfig {
  mode: Mode;
  immersion: Immersion;
  scenario?: string;
  model: string;
  voice: string;
  rate: number;
  silenceSec: number;
  manualSend: boolean;
}

export interface ConversationState {
  phase: Phase;
  turns: DisplayTurn[];
  interim: string;
  /** User text accumulated but not yet sent (final recognition results). */
  draft: string;
  error: string | null;
  listening: boolean;
  startedAt: string | null;
  speakingSec: number;
  words: number;
}

const STUCK_RE = /^(\s*(um+|uh+|er+|hmm+|ah+|eh+|えーと|あの|その)[,.\s]*)+$/i;

/**
 * Half-duplex voice conversation:
 *  user speaks -> (silence) -> send -> AI streams -> TTS per sentence (mic off)
 *  -> last sentence done -> mic on again. Tap during TTS interrupts.
 */
export function useConversation(cfg: ConversationConfig) {
  const [state, setState] = useState<ConversationState>({
    phase: 'idle',
    turns: [],
    interim: '',
    draft: '',
    error: null,
    listening: false,
    startedAt: null,
    speakingSec: 0,
    words: 0,
  });

  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const recognizer = useMemo(() => new WebSpeechRecognizer('en-US'), []);
  const synth = useMemo(() => new WebSpeechSynthesizer(), []);

  const history = useRef<ChatMessage[]>([]);
  const turnsRef = useRef<DisplayTurn[]>([]);
  const draftRef = useRef('');
  const draftStart = useRef<string | null>(null);
  const silenceTimer = useRef<number | null>(null);
  const speechStartAt = useRef<number | null>(null);
  const speakingMs = useRef(0);
  const lastAiEnd = useRef<number | null>(null);
  const latencies = useRef<number[]>([]);
  const abort = useRef<AbortController | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const sessionId = useRef(uuid());
  const sessionStart = useRef<string | null>(null);
  const ttsGeneration = useRef(0);

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setState((s) => ({ ...s, phase: p }));
  };

  const pushTurns = () => setState((s) => ({ ...s, turns: [...turnsRef.current] }));

  const clearSilence = () => {
    if (silenceTimer.current !== null) {
      window.clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
  };

  // ---- send the user's draft to the AI -------------------------------------
  const send = useCallback(async () => {
    clearSilence();
    const text = draftRef.current.trim();
    if (!text || phaseRef.current !== 'listening') return;
    draftRef.current = '';
    const startedAt = draftStart.current ?? new Date().toISOString();
    draftStart.current = null;
    const endedAt = new Date().toISOString();
    setState((s) => ({ ...s, draft: '', interim: '' }));

    turnsRef.current.push({ id: uuid(), role: 'user', text, startedAt, endedAt });
    history.current.push({ role: 'user', content: text });
    pushTurns();
    setState((s) => ({ ...s, words: s.words + text.split(/\s+/).filter(Boolean).length }));

    // Learner is stuck on fillers: nudge locally, no round-trip.
    if (STUCK_RE.test(text)) {
      await speakAi("Keep going — you can say it simply. What's the main thing?");
      return;
    }

    recognizer.stop(); // half-duplex: mic off while AI talks
    setPhase('thinking');
    const aiTurn: DisplayTurn = { id: uuid(), role: 'ai', text: '', startedAt: new Date().toISOString(), endedAt: '', streaming: true };
    turnsRef.current.push(aiTurn);
    pushTurns();

    const chunker = new SentenceChunker();
    const gen = ++ttsGeneration.current;
    const ttsQueue: Promise<void>[] = [];
    const c = cfgRef.current;
    const speakSentence = (s: string) => {
      if (gen !== ttsGeneration.current) return;
      if (phaseRef.current === 'thinking') setPhase('speaking');
      ttsQueue.push(synth.speak(s, { rate: c.rate, voice: c.voice }));
    };

    abort.current = new AbortController();
    let full = '';
    try {
      await streamChat(
        { mode: c.mode, immersion: c.immersion, scenario: c.scenario, model: c.model, messages: history.current },
        (ev) => {
          if (ev.type === 'text') {
            full += ev.text;
            aiTurn.text = full;
            pushTurns();
            chunker.push(ev.text).forEach(speakSentence);
          } else if (ev.type === 'error') {
            throw new Error(ev.message);
          }
        },
        abort.current.signal,
      );
      chunker.flush().forEach(speakSentence);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      }
    }
    aiTurn.streaming = false;
    aiTurn.endedAt = new Date().toISOString();
    if (full.trim()) history.current.push({ role: 'assistant', content: full.trim() });
    else turnsRef.current = turnsRef.current.filter((t) => t !== aiTurn);
    pushTurns();

    if (gen === ttsGeneration.current) {
      await Promise.all(ttsQueue);
      const now = phaseRef.current as Phase;
      if (gen === ttsGeneration.current && now !== 'ended' && now !== 'idle') {
        lastAiEnd.current = Date.now();
        resumeListening();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speakAi = async (text: string) => {
    recognizer.stop();
    setPhase('speaking');
    const gen = ++ttsGeneration.current;
    turnsRef.current.push({ id: uuid(), role: 'ai', text, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
    history.current.push({ role: 'assistant', content: text });
    pushTurns();
    await synth.speak(text, { rate: cfgRef.current.rate, voice: cfgRef.current.voice });
    if (gen === ttsGeneration.current && phaseRef.current === 'speaking') {
      lastAiEnd.current = Date.now();
      resumeListening();
    }
  };

  const resumeListening = () => {
    setPhase('listening');
    recognizer.setKeepAlive(true);
    recognizer.start();
  };

  const armSilence = () => {
    clearSilence();
    if (cfgRef.current.manualSend) return;
    silenceTimer.current = window.setTimeout(() => void send(), cfgRef.current.silenceSec * 1000);
  };

  // ---- recognizer wiring ----------------------------------------------------
  useEffect(() => {
    recognizer.onResult(({ final, interim }) => {
      if (phaseRef.current !== 'listening') return; // ignore echoes of our own TTS
      if (final) {
        if (!draftRef.current) {
          draftStart.current = new Date().toISOString();
          if (lastAiEnd.current) {
            latencies.current.push((Date.now() - lastAiEnd.current) / 1000);
            lastAiEnd.current = null;
          }
        }
        draftRef.current = (draftRef.current + ' ' + final).trim();
        setState((s) => ({ ...s, draft: draftRef.current, interim: '' }));
        armSilence();
      } else {
        setState((s) => ({ ...s, interim }));
        if (interim) clearSilence(); // still talking
      }
    });
    recognizer.onSpeechStart(() => {
      speechStartAt.current = Date.now();
      if (!draftRef.current && lastAiEnd.current) {
        latencies.current.push((Date.now() - lastAiEnd.current) / 1000);
        lastAiEnd.current = null;
      }
    });
    recognizer.onSpeechEnd(() => {
      if (speechStartAt.current) {
        speakingMs.current += Date.now() - speechStartAt.current;
        speechStartAt.current = null;
        setState((s) => ({ ...s, speakingSec: speakingMs.current / 1000 }));
      }
      if (draftRef.current) armSilence();
    });
    recognizer.onError((code) => {
      const msg = code === 'not-allowed' || code === 'service-not-allowed' ? 'mic-denied' : code === 'network' ? 'Speech recognition network error' : code;
      setState((s) => ({ ...s, error: msg }));
    });
    recognizer.onStateChange((listening) => setState((s) => ({ ...s, listening })));
    return () => {
      recognizer.stop();
      synth.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- public actions -------------------------------------------------------
  const start = useCallback(
    async (opening?: string) => {
      sessionId.current = uuid();
      sessionStart.current = new Date().toISOString();
      history.current = [];
      turnsRef.current = [];
      speakingMs.current = 0;
      latencies.current = [];
      setState({
        phase: 'listening',
        turns: [],
        interim: '',
        draft: '',
        error: null,
        listening: false,
        startedAt: sessionStart.current,
        speakingSec: 0,
        words: 0,
      });
      phaseRef.current = 'listening';
      if (opening) await speakAi(opening);
      else resumeListening();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Tap during AI speech: stop TTS, drop the queue, listen again. */
  const interrupt = useCallback(() => {
    if (phaseRef.current !== 'speaking' && phaseRef.current !== 'thinking') return;
    ttsGeneration.current += 1;
    synth.cancel();
    abort.current?.abort();
    lastAiEnd.current = Date.now();
    resumeListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const end = useCallback((): SessionPayload | null => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'ended') return null;
    clearSilence();
    ttsGeneration.current += 1;
    synth.cancel();
    abort.current?.abort();
    recognizer.stop();
    if (speechStartAt.current) {
      speakingMs.current += Date.now() - speechStartAt.current;
      speechStartAt.current = null;
    }
    setPhase('ended');

    const turns: Turn[] = turnsRef.current
      .filter((t) => t.text.trim())
      .map((t) => ({ id: t.id, sessionId: sessionId.current, role: t.role, text: t.text, startedAt: t.startedAt, endedAt: t.endedAt || t.startedAt }));
    const userTurns = turns.filter((t) => t.role === 'user');
    const measured = speakingMs.current > 0 ? speakingMs.current / 1000 : null;
    const m = computeMetrics(userTurns, measured);
    const lat = latencies.current;
    const session: Session = {
      id: sessionId.current,
      mode: cfgRef.current.mode,
      scenario: cfgRef.current.scenario ?? null,
      startedAt: sessionStart.current ?? new Date().toISOString(),
      endedAt: new Date().toISOString(),
      ...m,
      errorRate: 0,
      avgLatencySec: lat.length ? Math.round((lat.reduce((a, b) => a + b, 0) / lat.length) * 10) / 10 : 0,
      jpHintCount: 0,
      xp: computeXp(m),
    };
    return { session, turns };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    supported: recognizer.supported,
    start,
    send: () => void send(),
    interrupt,
    end,
  };
}
