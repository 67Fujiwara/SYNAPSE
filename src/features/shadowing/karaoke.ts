import { useCallback, useEffect, useRef, useState } from 'react';
import { WebSpeechSynthesizer } from '@/lib/speech/synthesis';

/**
 * Read a sentence aloud and report which word is being spoken, using the
 * SpeechSynthesis `boundary` event. Browsers without boundary events (iOS
 * Safari) fall back to a timer proportional to character count.
 */
export function useKaraoke() {
  const [wordIndex, setWordIndex] = useState(-1);
  const [speaking, setSpeaking] = useState(false);
  const synth = useRef(new WebSpeechSynthesizer());
  const timers = useRef<number[]>([]);
  const lastDuration = useRef(0);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const stop = useCallback(() => {
    clear();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeaking(false);
    setWordIndex(-1);
  }, []);

  useEffect(() => stop, [stop]);

  /** Resolves when the utterance finishes. Returns the measured duration in seconds. */
  const speak = useCallback(
    (text: string, rate: number, voice?: string): Promise<number> =>
      new Promise((resolve) => {
        if (!('speechSynthesis' in window)) return resolve(0);
        stop();
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
      }),
    [stop],
  );

  return { speak, stop, wordIndex, speaking, lastDuration };
}
