import { useEffect, useState } from 'react';
import { api, getToken } from '@/lib/api/client';

let cached: boolean | null = null;

/** Whether the Worker offers server-side speech-to-text (Workers AI or STT_API_KEY). Checked once per page load. */
export function useServerStt(): boolean {
  const [ok, setOk] = useState(cached ?? false);
  useEffect(() => {
    if (cached !== null || !getToken()) return;
    api
      .health()
      .then((h) => {
        cached = h.stt;
        setOk(h.stt);
      })
      .catch(() => {});
  }, []);
  return ok;
}
