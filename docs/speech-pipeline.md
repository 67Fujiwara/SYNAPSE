# 音声まわりの実装メモ（他のアプリに移植するためのまとめ）

SYNAPSE の「話す → 文字 → AI → 声」は、外部の音声サービスを契約せず **Cloudflare Workers AI** だけで動いている。
別のボットに同じものを載せるときに読む。コードはこのリポジトリからそのまま持っていける。

| 役割 | モデル | ファイル |
|---|---|---|
| 音声認識（STT） | `@cf/openai/whisper-large-v3-turbo` | Worker `worker/index.ts` の `/api/transcribe`、ブラウザ `src/lib/speech/server-recognizer.ts` |
| 読み上げ（TTS） | `@cf/deepgram/aura-2-en`（英語 40 声） | Worker `/api/tts`、ブラウザ `src/lib/speech/server-synthesizer.ts`、声の一覧 `shared/voices.ts` |
| 幻聴フィルタ | 純 TS | `shared/hallucination.ts` |

費用: どちらも Workers AI の無料枠（1 日 10,000 ニューロン）に収まる使い方。鍵は要らない。

---

## 1. Worker 側

### wrangler.toml

```toml
[ai]
binding = "AI"

# TTS のキャッシュ用（任意。無くても動く）
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "your-bucket"
```

`[ai]` を書くと `wrangler dev` もログイン済みの Cloudflare 経由で動く（ローカルで AI は動かない）。
ログイン無しの環境でテストするときは `[ai]` を外した別の toml を使う。

### /api/transcribe（音声 → 文字）

ブラウザから `multipart/form-data` で `audio`（webm / mp4 / ogg のどれでも可）を受け取り、base64 にして Whisper に渡す。

```ts
app.post('/api/transcribe', async (c) => {
  const form = await c.req.formData();
  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) return c.json({ error: 'audio file required' }, 400);
  const context = String(form.get('context') ?? '').slice(0, 300); // 直前の相手の発言。あると精度が上がる

  const bytes = new Uint8Array(await audio.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); // 一気に展開すると引数上限で落ちる

  const out = (await c.env.AI.run('@cf/openai/whisper-large-v3-turbo', {
    audio: btoa(bin),
    task: 'transcribe',
    language: 'en',
    vad_filter: true,
    initial_prompt: `Casual conversation. ${context ? `The other person just said: "${context}"` : ''}`,
    beam_size: 5,
    condition_on_previous_text: false,
  })) as { text?: string; segments?: { no_speech_prob?: number; avg_logprob?: number }[] };

  const text = (out.text ?? '').trim();
  // 無音のクリップで Whisper は字幕の決まり文句を作る（"Thanks for watching" など）。捨てる。
  if (!text || looksHallucinated(text) || lowConfidence(out.segments)) return c.json({ text: '' });
  return c.json({ text });
});
```

`looksHallucinated` / `lowConfidence` は `shared/hallucination.ts` をそのままコピーする（テスト付き）。
`lowConfidence` は `no_speech_prob > 0.6` または `avg_logprob < -1.0` の平均で捨てる。騒がしい場所向けに厳しい閾値（0.35 / -0.8）も持っている。

### /api/tts（文字 → mp3）

```ts
app.post('/api/tts', async (c) => {
  const { text, voice } = await c.req.json();
  const t = String(text ?? '').trim().slice(0, 1000);
  const speaker = voice || 'luna'; // 声の id 一覧は shared/voices.ts

  const out = await c.env.AI.run('@cf/deepgram/aura-2-en', { text: t, speaker, encoding: 'mp3' });
  // 型は版で変わるので全部受ける: ReadableStream / ArrayBuffer / base64 文字列 / { audio: base64 }
  let bytes: ArrayBuffer;
  if (out instanceof ReadableStream) bytes = await new Response(out).arrayBuffer();
  else if (out instanceof ArrayBuffer) bytes = out;
  else if (typeof out === 'string') bytes = Uint8Array.from(atob(out), (ch) => ch.charCodeAt(0)).buffer;
  else bytes = Uint8Array.from(atob(out.audio), (ch) => ch.charCodeAt(0)).buffer;

  return new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg' } });
});
```

同じ文は同じ音になるので、R2 に `tts-cache/<sha256(speaker|text)>.mp3` で置いておくと 2 回目以降はモデルを呼ばない（SYNAPSE の実装はこれ込み）。

---

## 2. ブラウザ側

### 録音して送る（`ServerRecognizer`）

- `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` → `MediaRecorder`。
  タイムスライス無しで **1 クリップ = 1 つの完結したファイル**にする（iOS の mp4 はこれでないと壊れる）
- **無音検出（VAD）** を自前で持つ: `AnalyserNode` で 50ms ごとに RMS を取り、
  「閾値を 300ms 連続で超えたら声の始まり」「声のあと 1.2 秒静かなら終わり」。終わったら `recorder.stop()` → blob を `/api/transcribe` へ
- 閾値は `max(0.02, ノイズ床 × 4)`。ノイズ床は **直近 2 秒の RMS の 20 パーセンタイル**（平均にすると声そのものを学習して閾値が逃げる）
- 声の合計が 600ms 未満のクリップは送らない（咳やクリック）。8 秒以上途切れず大きい音は定常ノイズとみなして床にする
- アプリ自身が音を再生している間は **ミュート**（録音中のクリップを捨て、床の学習も止める）。解除時に床をリセット。
  これをしないと、再生直後の 2 秒間は閾値がスピーカー音量基準になって声を拾えない（実機で起きた）
- 声が無かったクリップでも「空の結果」を返す。待っている側が「文字起こし中」のまま固まらないため

ファイルは `src/lib/speech/server-recognizer.ts` 1 本。`types.ts` のインターフェースとセットで持っていく。

### 再生する（`ServerSynthesizer`）

- 文ごとに `/api/tts` を叩いて blob を受け取り、**1 つの `<audio>` 要素を使い回して**順番に再生する。
  文ごとに `new Audio()` を作ると iOS で 2 本目以降が鳴らない
- **iOS は「タップの中」で始めた音しか鳴らない**。開始ボタンのハンドラで `unlock()`（100ms の本物の無音 WAV をその要素で再生）を 1 回呼ぶ。
  データ部 0 バイトの data-URI は使わない（要素が再生できない状態で固まる）
- 速度は `audio.playbackRate`（Aura に速度指定は無い）
- `ended` が来ないことがあるので「長さ + 1.5 秒」の保険タイマーで次へ進める
- 先読み: 文が確定した時点で fetch を始め、再生は順番を守る（AI のストリーミング返答と相性がよい）

### iOS で録音するときの注意

- `getUserMedia` と `AudioContext` も **タップの中で**始める。画面遷移してから呼ぶと「拒否」になる（`primeMic()` をタップで呼び、あとで引き取る）
- iPhone の Chrome には Web Speech API が無いので、認識は必ずこのサーバー方式になる
- 本体の 設定 → Chrome → マイク がオフだと何をしても `NotAllowedError`

---

## 3. 会話に組み込むときの型

```
AI が話し終える → マイク ON（listening）
 → 声の始まり（VAD） → 声の終わり → クリップを送る（transcribing）
 → 文字が返る → AI に送る（thinking） → 返答をストリーミングで受けつつ文ごとに TTS（speaking、マイク OFF）
 → 全部鳴り終わったら最初へ
```

- 半二重にする（AI が話している間はマイクを止める）。スピーカーの音を拾って自分の発言にしてしまうのを防ぐ
- 1〜2 語の聞き取りが 3 回続いたら「ノイズを拾っている」とみなして、タップして話すに切り替える（屋外対策）
- Whisper は話し終えてから文字になる（途中経過は出ない）。「文字起こし中…」の表示を出す

---

## 4. 持っていくファイル一覧

```
shared/hallucination.ts            幻聴フィルタ（+ .test.ts）
shared/voices.ts                   Aura の声の一覧
src/lib/speech/types.ts            Recognizer / Synthesizer のインターフェース
src/lib/speech/server-recognizer.ts  録音 + VAD + アップロード
src/lib/speech/server-synthesizer.ts 順番再生 + iOS 解錠
worker/index.ts の /api/transcribe と /api/tts
```

`api.transcribe(blob, context)` / `api.tts(text, voice)` の 2 つの fetch ラッパーだけ自分のクライアントに合わせて書き換えればよい。
