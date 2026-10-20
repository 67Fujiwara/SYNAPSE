import { useEffect, useState } from 'react';
import { api, getToken } from '@/lib/api/client';

let cached: { stt: boolean; tts: boolean } | null = null;

/** What the Worker offers (Workers AI speech-to-text / text-to-speech). Checked once per page load. */
export function useServerStt(): { stt: boolean; tts: boolean } {
  const [v, setV] = useState(cached ?? { stt: false, tts: true }); // optimistic for tts: falls back after the check
  useEffect(() => {
    if (cached !== null || !getToken()) return;
    api
      .health()
      .then((h) => {
        cached = { stt: h.stt, tts: h.tts };
        setV(cached);
      })
      .catch(() => {});
  }, []);
  return v;
}
