// 会議を録音して 45 秒ごとに /api/minutes/transcribe へ送るブラウザ側（PC の Chrome / Edge）。
// マイクに加えて、オンライン会議の「タブの音声」も混ぜられる（getDisplayMedia）。
//
// 区切りは MediaRecorder の timeslice ではなく **stop → start** で作る。timeslice の断片は
// 2 個目以降にコンテナのヘッダが無く、Whisper が読めないことがある。stop/start なら各区切りが完結したファイルになる。

export interface ChunkResult {
  seq: number;
  startSec: number;
  text: string;
  segments: { start: number; end: number; text: string }[];
  dropped?: string;
}

export interface RecorderOptions {
  /** 送り先（既定 /api/minutes/transcribe） */
  endpoint?: string;
  /** 認証ヘッダなど */
  headers?: Record<string, string>;
  /** 区切りの長さ（秒）。30〜60 が実用的 */
  chunkSec?: number;
  /** オンライン会議のタブ音声も混ぜる（選択ダイアログが出る） */
  includeTab?: boolean;
  /** 'ja' / 'en' など。混在なら 'ja' にして用語を glossary へ */
  language?: string;
  /** 案件名・人名・社内用語（カンマ区切り）。固有名詞の誤りが減る */
  glossary?: string;
  onChunk: (r: ChunkResult) => void;
  onError?: (e: Error) => void;
}

export interface MeetingRecorder {
  stop(): Promise<void>;
  /** 録音開始からの秒 */
  elapsedSec(): number;
}

export async function startMeetingRecorder(opts: RecorderOptions): Promise<MeetingRecorder> {
  const endpoint = opts.endpoint ?? '/api/minutes/transcribe';
  const chunkMs = (opts.chunkSec ?? 45) * 1000;

  // 入力: マイク（エコー除去・ノイズ抑制あり）+ 任意でタブ音声。AudioContext で 1 本に合成する。
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  ctx.createMediaStreamSource(mic).connect(dest);
  let tab: MediaStream | null = null;
  if (opts.includeTab) {
    // Chrome は video: true でないと音声を出させてくれない。映像トラックはすぐ止める。
    tab = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    tab.getVideoTracks().forEach((t) => t.stop());
    if (tab.getAudioTracks().length) ctx.createMediaStreamSource(tab).connect(dest);
  }

  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
  const t0 = Date.now();
  let seq = 0;
  let prevTail = '';
  let stopping = false;
  let rec: MediaRecorder | null = null;
  let timer: number | null = null;
  const queue: Promise<void>[] = [];

  const upload = async (blob: Blob, mySeq: number, startSec: number) => {
    const form = new FormData();
    form.append('audio', blob, `chunk-${mySeq}.webm`);
    form.append('seq', String(mySeq));
    form.append('startSec', String(startSec));
    form.append('language', opts.language ?? 'ja');
    if (opts.glossary) form.append('glossary', opts.glossary);
    if (prevTail) form.append('prev', prevTail);
    const res = await fetch(endpoint, { method: 'POST', headers: opts.headers, body: form });
    if (!res.ok) throw new Error(`transcribe failed: ${res.status} ${await res.text()}`);
    const r = (await res.json()) as ChunkResult;
    if (r.text) prevTail = r.text.slice(-300); // 次の区切りの initial_prompt に渡す
    opts.onChunk(r);
  };

  /** 区切りを 1 つ作って送り、次の区切りを始める */
  const rotate = () => {
    const current = rec;
    if (!current) return;
    rec = null;
    current.stop(); // -> onstop で送る
    if (!stopping) begin();
  };

  const begin = () => {
    const r = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
    const chunks: Blob[] = [];
    const startSec = (Date.now() - t0) / 1000;
    const mySeq = seq++;
    r.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    r.onstop = () => {
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      if (blob.size < 2000) return; // 空の区切り
      // 順番を守って送る（前の区切りの末尾を次の prompt に使うため）
      const prev = queue[queue.length - 1] ?? Promise.resolve();
      queue.push(prev.then(() => upload(blob, mySeq, startSec)).catch((e) => opts.onError?.(e instanceof Error ? e : new Error(String(e)))));
    };
    r.start(); // timeslice 無し: 1 区切り = 1 つの完結したファイル
    rec = r;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(rotate, chunkMs);
  };

  begin();

  return {
    elapsedSec: () => (Date.now() - t0) / 1000,
    async stop() {
      stopping = true;
      if (timer !== null) window.clearTimeout(timer);
      rotate(); // 最後の区切りを送る
      await Promise.all(queue);
      mic.getTracks().forEach((t) => t.stop());
      tab?.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

/*
使い方:
  const rec = await startMeetingRecorder({
    includeTab: true,
    glossary: 'SYNAPSE, 藤原, 制御盤, FAT, 納期',
    headers: { Authorization: `Bearer ${token}` },
    onChunk: (r) => appendToTranscript(r),   // 画面に逐次表示 / D1 に保存
  });
  ... 会議終了 ...
  await rec.stop();
  // 全文を Claude に渡して議事録（決定事項・宿題・担当・期限）を作る
*/
