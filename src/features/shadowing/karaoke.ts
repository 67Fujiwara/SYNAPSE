import { useCallback, useEffect, useRef, useState } from 'react';
import { WebSpeechSynthesizer } from '@/lib/speech/synthesis';
import { api } from '@/lib/api/client';
import type { TtsEngine } from '@shared/types';

/**
 * Read a sentence aloud and report which word is being spoken, using the
 * SpeechSynthesis `boundary` event. Browsers without boundary events (iOS
 * Safari) fall back to a timer proportional to character count.
 */
export function useKaraoke(engine: TtsEngine = 'browser', serverVoice = 'thalia') {
  const [wordIndex, setWordIndex] = useState(-1);
  const [speaking, setSpeaking] = useState(false);
  const synth = useRef(new WebSpeechSynthesizer());
  const audio = useRef<HTMLAudioElement | null>(null);
  const timers = useRef<number[]>([]);
  const lastDuration = useRef(0);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const stop = useCallback(() => {
    clear();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (audio.current) {
      audio.current.pause();
      audio.current = null;
    }
    setSpeaking(false);
    setWordIndex(-1);
  }, []);

  /** Server voice: play the mp3 and advance the highlight by character share of the real duration. */
  const speakServer = useCallback(
    (text: string, rate: number): Promise<number> =>
      new Promise((resolve) => {
        const words = text.split(/\s+/).filter(Boolean);
        const total = text.replace(/\s+/g, '').length || 1;
        api
          .tts(text, serverVoice)
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            const a = new Audio(url);
            a.playbackRate = rate;
            a.style.display = 'none';
            document.body.appendChild(a); // keep it alive while playing (see ServerSynthesizer)
            audio.current = a;
            const t0 = performance.now();
            a.onplay = () => {
              setSpeaking(true);
              setWordIndex(0);
              const durMs = ((Number.isFinite(a.duration) ? a.duration : text.length * 0.06) / rate) * 1000;
              let acc = 0;
              words.forEach((w, i) => {
                acc += w.length;
                timers.current.push(window.setTimeout(() => setWordIndex(Math.min(i + 1, words.length - 1)), (acc / total) * durMs * 0.95));
              });
            };
            const done = () => {
              clear();
              URL.revokeObjectURL(url);
              lastDuration.current = (performance.now() - t0) / 1000;
              setSpeaking(false);
              setWordIndex(-1);
              a.remove();
              audio.current = null;
              resolve(lastDuration.current);
            };
            a.onended = done;
            a.onerror = done;
            a.play().catch(done);
          })
          .catch(() => resolve(0));
      }),
    [serverVoice],
  );

  useEffect(() => stop, [stop]);

  /** Resolves when the utterance finishes. Returns the measured duration in seconds. */
  const speak = useCallback(
    (text: string, rate: number, voice?: string): Promise<number> => {
      stop();
      if (engine === 'server') return speakServer(text, rate);
      return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) return resolve(0);
        const words = text.split(/\s+/).filter(Boolean);
        // char offset -> word index
        const starts: number[] = [];
        let pos = 0;
        for (const w of words) {
          const i = text.indexOf(w, pos);
          starts.push(i);
          pos = i + w.length;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = rate;
        const v = synth.current.pickVoice(voice);
        if (v) u.voice = v;
        let sawBoundary = false;
        const t0 = performance.now();
        u.onboundary = (e) => {
          if (e.name && e.name !== 'word') return;
          sawBoundary = true;
          clear();
          let idx = 0;
          for (let i = 0; i < starts.length; i++) if (starts[i] <= e.charIndex) idx = i;
          setWordIndex(idx);
        };
        u.onstart = () => {
          setSpeaking(true);
          setWordIndex(0);
          // Fallback highlight: advance by character share of an estimated duration.
          const estMs = (text.length * 65) / rate + 300;
          const total = text.replace(/\s+/g, '').length || 1;
          let acc = 0;
          words.forEach((w, i) => {
            acc += w.length;
            const at = (acc / total) * estMs;
            timers.current.push(
              window.setTimeout(() => {
                if (!sawBoundary) setWordIndex(Math.min(i + 1, words.length - 1));
              }, at),
            );
          });
        };
        const done = () => {
          clear();
          lastDuration.current = (performance.now() - t0) / 1000;
          setSpeaking(false);
          setWordIndex(-1);
          resolve(lastDuration.current);
        };
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
      });
    },
    [stop, engine, speakServer],
  );

  return { speak, stop, wordIndex, speaking, lastDuration };
}
