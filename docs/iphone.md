# iPhone で使う（Phase 1.5）

iPhone 対応は「機能」ではなく **置き場所と音声まわりの制約** の問題。ここに準備したものと、実機でしか確かめられないことを分けて書く。

## 準備済み（iPhone が無くてもできたこと）

| 項目 | 実装 |
|---|---|
| https の 1 URL で画面と API を配信 | `wrangler.toml` の `[assets]`。`npm run deploy` 1 回で Worker に `dist/` も載る。`/api/*` だけ Worker が処理し、他は静的ファイル → 無ければ `index.html`（SPA） |
| ホーム画面に追加 → 全画面で開く（PWA） | `public/manifest.webmanifest`、`public/icons/*`、`index.html` の `apple-mobile-web-app-*` メタ |
| iOS は読み上げを「タップの中」で始めないと鳴らない | `WebSpeechSynthesizer.unlock()`。Start talking のタップ内で無音の発話を 1 回流して解錠（`TalkPage.begin`） |
| iOS Safari は認識を勝手に再開できない | **タップして話す（push）モード**。`micMode: 'auto'` は iPhone で自動的に push になる（`isIOS()`）。AI が話し終えたら `ready` で待ち、丸いマイクボタンのタップで聞き始める。もう一度タップで送信 |
| Safari の認識がそもそも使い物にならない場合の保険 | **サーバー認識エンジン**（設定 → 音声入力 → 認識エンジン → サーバー）。`MediaRecorder` で録音 → `POST /api/transcribe` → Worker が OpenAI 互換の `/audio/transcriptions` に転送。Worker 側は `STT_API_KEY`（任意で `STT_BASE_URL` / `STT_MODEL`）を設定したときだけ有効。未設定なら 501 を返し、設定画面にその旨を出す |
| AudioContext が iOS では suspended で始まる | `MicAnalyser.start()` で `resume()` |
| 画面 | 390px 幅で確認済み。下タブ、`100dvh`、`safe-area-inset-bottom` |

ヘッドレス Chromium に iPhone の UA を名乗らせ、偽の認識 API で **開始 → ready → タップ → 聞く → タップ → 送信 → AI → ready** が通ることは確認済み（`docs/worklog.md`）。

## iPhone の Chrome で使う（2026-10-19 追加）

iPhone の Chrome には音声認識 API が無い。そこで **サーバー認識（Workers AI の Whisper）** を標準にした。
- Worker に `[ai] binding = "AI"`。`/api/transcribe` が `@cf/openai/whisper-large-v3-turbo` で文字起こしする（キー不要、Workers AI の無料枠）
- ブラウザに認識 API が無ければ自動でサーバー方式になる（`TalkPage` の `engine`）。PC でも 設定 → 認識エンジン → サーバー で選べる
- `ServerRecognizer` に無音検出（マイクの RMS）を入れたので、**タップしなくても黙れば送信**される（PC の常時オンでも使える）。
  iPhone では「タップして話す」のまま（録音開始にジェスチャが要るため）
- 録音は `MediaRecorder`（iOS は `audio/mp4`）。Whisper はそのまま受け付ける
- 文字は話している最中には出ず、黙ってから 1〜2 秒後に出る（録音 → アップロード → 文字起こし）

確認: ヘッドレス Chromium に偽マイク（WAV の音）を与え、認識 API を消した状態で **自動でサーバー方式になる → 音を検出 → 無音でクリップ終了 → アップロード（40KB）→ 文字が自分の発言になる** まで通した。Whisper 本体はこの環境から呼べないので未確認（Cloudflare へのデプロイ後に実機で）。

## 実機でしか分からないこと（チェックリスト）

デプロイ後、iPhone の **Safari** で `https://…workers.dev` を開いて確認する。Chrome for iOS は音声認識 API が使えないことがあるので Safari で。

- [ ] 「共有 → ホーム画面に追加」でアイコン付きで追加でき、開くとアドレスバーが消える
- [ ] Settings → App token を入れて Test connection が「Anthropic key is valid」
- [ ] Talk → Start talking で **AI の最初の一言が鳴る**（鳴らなければ `unlock()` のタイミングか、音量 / サイレントスイッチ）
- [ ] マイクボタンのタップで権限ダイアログ → 許可 → 「Listening」になり、話すと薄い文字が出る
- [ ] もう一度タップで送信され、AI が返事を**声で**返す（ここが iOS 最大の関門: ネットワーク往復のあとの speak が鳴るか）
- [ ] AI の返事のあと自動で「Tap the mic to talk」に戻る
- [ ] 2〜3 往復しても認識が死なない（死ぬなら Safari の仕様。→ サーバー認識エンジンへ）
- [ ] 画面をロックして戻しても、次のタップで続けられる
- [ ] 終了 → サマリー → ダッシュボードに反映（PC で開いても同じ数字）

### Safari の認識がダメだったとき
1. 文字起こし API のキーを用意する（OpenAI の Whisper か、互換 API を出している他社）
2. `npx wrangler secret put STT_API_KEY`（互換 API なら `wrangler.toml` の `[vars]` に `STT_BASE_URL` / `STT_MODEL` も）
3. iPhone の Settings → 音声入力 → 認識エンジン → **サーバー**。マイクモードは自動的に push になる
4. 録音は `audio/mp4`（Safari）か `audio/webm`（Chrome）。Worker が拡張子を付けて転送する

費用は文字起こし API の従量課金（目安: 1 分あたり数円）。会話 10 分で数十円。

## 既知の制限
- 常時オン（continuous）モードは iPhone では当てにしない。PC では今までどおり
- iOS の読み上げ音声は端末の設定（設定 → アクセシビリティ → 読み上げコンテンツ → 声）で品質が変わる。Siri の声（Enhanced）をダウンロードしておくと自然になる
- バックグラウンド（画面オフ・他アプリ）では認識も読み上げも止まる。PWA でも同じ
