# 作業メモ

## 2026-10-17 — Phase 1（MVP）を一から実装

- 仕様書 `docs/SYNAPSE_English_App_Spec.md` の Phase 1 を実装。構成は仕様どおり Vite + React 18 + TS + Tailwind / Workers + Hono / D1。
- **会話の中核は `src/features/conversation/useConversation.ts`**（半二重）。状態は `idle → listening → thinking → speaking → listening … → ended`。
  - 認識は `continuous + interimResults`。final が来て `silenceSec`（既定 1.2s）新しい interim が無ければ送信。
  - AI の返答は SSE で受け、`SentenceChunker` が文末を見つけるたびに TTS に流す。最後の文の `onend` でマイクを再開。
  - TTS 中の認識結果は `phaseRef !== 'listening'` で捨てる（自分の声の拾い込み対策）。タップで `interrupt()`。
  - `ttsGeneration` カウンタで「古い返答の TTS 完了」が新しい状態を壊さないようにしている。
- **Worker は Anthropic SDK の `messages.stream()` を使い、`text_delta` を `data: {"type":"text"}` に詰め替えてそのまま流す**（バッファしない）。
  会話は `claude-sonnet-5-5` + `output_config.effort: 'low'`（速度優先）、`max_tokens: 400` で短く。`stop_reason === 'refusal'` は一言で話題を変える。
- プロンプトは `worker/prompts/*.md`。`wrangler.toml` の `[[rules]] type="Text"` で import。順序は 共通 → 没入度 → モード → シナリオ（キャッシュの前方一致を保つため固定）。
- `/api/sessions` は冪等（同じ id なら前回分を daily_stats から引いてから足す）。オフライン再送で二重計上しない。
- 日付はクライアントが `X-Local-Date` ヘッダで送る（サーバーは UTC なので「今日」をサーバーで決めない）。
- Web Speech の型は lib.dom に無いので `src/lib/speech/webspeech.d.ts` に最小限を置いた。

### 検証
- `npm test` 14 件、`tsc -b`、`vite build` 通過（JS 608KB / gzip 188KB。recharts が大半）。
- `wrangler dev` でローカル D1 に対して全ルートを curl で確認（401 / health / sessions 冪等 / stats ストリーク / settings / chat SSE エラー）。
- Playwright + 偽の SpeechRecognition / speechSynthesis で 会話開始 → 発話 → 自動送信 → /api/chat → 終了 → サマリー → /api/sessions まで通した。コンソールエラー 0。
- **実機（マイク付き Chrome）と本物の API キーでは未確認。** README のチェックリストの ⬜ を次回確認する。

### 気づいたこと / 直したバグ
- SSE リーダーで `onEvent` を `try/catch` の中で呼んでいて、ハンドラの throw（API エラー）が握りつぶされていた → parse と呼び出しを分離。
- 偽の認識では発話時間が 0.3s になり WPM が 2000 を超えた → 語数に対して短すぎる計測は捨ててターンの長さで代替、WPM は 300 で頭打ち。
- headless Chromium には **ネイティブの `SpeechRecognition` がある**ので、テストで偽物を入れるときは `webkitSpeechRecognition` だけでなく両方を上書きする。

### 次（Phase 2）
1. セッション後レビュー `/api/review`（`claude-opus-5-5`、構造化出力で corrections / betterPhrases / wins）→ `reviews` テーブルは作成済み
2. シャドーイング（素材化・`boundary` イベントのカラオケ・§4.2 のアライメント採点・間隔反復）→ `shadow_items` / `shadow_attempts` 作成済み
3. 単語タップのポップアップ（IPA / 定義 / 例文）
4. My Work はシナリオ生成まで実装済み。会話中の「Say it differently」ヒントパネルは未実装

## 2026-10-18 — Phase 1.5: iPhone 対応の土台

- ユーザーの要望「iPhone でも使いたい。Phase 3 までに課題を解決しておく」→ iPhone 無しでできる準備を先に全部やった。詳細は `docs/iphone.md`
- **1 URL 化**: `wrangler.toml` `[assets]`（`directory=./dist`, `not_found_handling=single-page-application`, `run_worker_first=["/api/*"]`）。
  `npm run deploy` = build + `wrangler deploy`。Pages は使わない（CORS も `_redirects` も不要になる）。ローカルは `npm run preview:worker` で同じ形を確認（/ と /settings が 200 text/html、manifest・icon が 200、/api/* は Worker）
- **PWA**: manifest + icons（Chromium のキャンバスで SVG → PNG。`tools/` には入れていない。再生成は scratchpad の icons.mjs 相当）+ iOS メタ
- **push-to-talk**: `Phase` に `ready` を追加。`micMode: 'auto' | 'continuous' | 'push'`（auto は `isIOS()` で push）。`tapMic()` が ready→listening、listening→送信。
  `resumeListening()` が push では `ready` にして止まる（iOS Safari は gesture 無しで `recognition.start()` できない前提）
- **サーバー認識**: `ServerRecognizer`（MediaRecorder、タップで開始・タップで停止 → `/api/transcribe`）。Worker は OpenAI 互換 `/audio/transcriptions` に転送、`STT_API_KEY` が無ければ 501。
  `Recognizer` インターフェースはそのまま（仕様の「差し替え可能」を実際に 2 実装にした）。サーバー方式は結果が 1 クリップ 1 回なので `onResult` で即 `send()`
- **iOS 音声解錠**: `WebSpeechSynthesizer.unlock()` を Start talking のクリック内で呼ぶ。`MicAnalyser` は `AudioContext.resume()`
- 検証: tsc / vitest 14 / build 通過。iPhone UA のヘッドレス Chromium で 開始→ready→タップ→聞く→タップ→送信→（API エラー表示）→ready を確認、コンソールエラー 0。**実機 Safari は未確認**（チェックリストは docs/iphone.md）
- 今日のサポートで分かったこと: `.dev.vars` に curl コマンドをそのまま貼ってしまうケースがあった。Test connection がキーの先頭・末尾・文字数を出すようにしたので、次からはそこで気づける

## 2026-10-18 (続き) — 実機で会話成立 / 日本語字幕

- ユーザーの PC Chrome で会話が成立した（`sk-ant-usr-` 形式のキー + ワークスペース）。詰まった点は順に:
  `.dev.vars` に curl コマンドを貼った → 1 行目にワークスペース ID を貼った → キーの形式。Test connection を
  `messages.countTokens`（無料）で検査するようにしたので、認証・ワークスペースのどちらで落ちたかを設定画面で言える
- **`sk-ant-usr-` キーは `anthropic-workspace-id` ヘッダーが必要**（400 で教えてくれる）。`ANTHROPIC_WORKSPACE_ID` を
  `defaultHeaders` で付ける。ワークスペースの中で作ったキーなら不要
- **日本語字幕**（要望「モードによって英文の下に日本語」）: `/api/translate`（`claude-haiku-5-5`、`worker/prompts/translate.md`）。
  AI の行が確定してから裏で取りに行き `DisplayTurn.ja` に付ける（TTS を待たせない）。表示は没入度で分岐:
  Low = 常に表示 / Medium = 「訳」ボタンで開く（開いた回数を `jpHintCount` に記録、サマリーに出す）/ High = 取りに行かない。
  Playwright で 3 段を確認（`/api/translate` はモック）
- 気づき: React は `aria-pressed={undefined}` を属性ごと落とす。テストのセレクタが外れた。`Boolean()` で明示

## 2026-10-18 (続き) — Phase 2

- **レビュー** `/api/review`: `client.messages.parse` + `zodOutputFormat`（zod は **v4** が必要。v3 だと SDK の型が合わない）。
  モデルは `claude-opus-5-5`、`effort: 'medium'`。保存時に `sessions.error_rate` = 修正数 / 100 語 を書き戻す。
  会話終了 → `persistSession` が synced のときだけ生成（オフラインならレビュー画面の「レビューを作る」で後から）
- **シャドーイング**: 採点は `src/lib/align`（§4.2 どおり。置換コストは 同一 0 / 近い 0.5 / 違う 1 で DP、スコア = (一致 + 惜しい×0.5) / 参照語数）。
  間隔反復は `shared/srs.ts`（Worker の `recordAttempt` が計算）。カラオケは `useKaraoke`（`boundary` が来なければ文字数比例のタイマー）。
  Practice の認識は設定の `sttEngine` に従う（ブラウザ / サーバー）。final が来て 0.9 秒で採点、無音は 6 秒で打ち切り
- **単語ポップアップ** `/api/word`（haiku 5.5、構造化出力）。`Transcript` の AI 行を語ごとの `<button>` にした（`Tappable`）。
  没入度 High では日本語を出さない。「この文をシャドーイングに保存」は含んでいる文を `source: 'conversation'` で登録
- マイグレーション `0002_phase2.sql`（`reviews.term_notes`, `shadow_attempts.mode`）。**本番は `npm run db:migrate:remote` を忘れない**
- 検証: tsc / vitest 21 / build（JS 655KB, gzip 204KB）。Worker はローカル D1 で curl（重複スキップ・55%→翌日・95%→3 日・Recall で習得 +1）。
  ブラウザは AI 系の 3 エンドポイントをモックして デッキ → 練習 → 採点 → レビュー → 単語 → サマリー を通した
- 未着手: iPhone Chrome 向けの Workers AI Whisper（ユーザーの指示で Phase 2 を先に）。`[ai] binding="AI"` と
  `@cf/openai/whisper-large-v3-turbo`（入力 `audio: base64`）で `/api/transcribe` を置き換える。型は workers-types にある

## 2026-10-19 — サーバー認識（Whisper on Workers AI）と無音検出

- ユーザー: 「Chrome 内蔵の認識は精度が悪い」「iPhone は Chrome しか使わない」→ Workers AI の Whisper を標準に
- `wrangler.toml` に `[ai] binding = "AI"`。`/api/transcribe` は AI バインディングがあれば `@cf/openai/whisper-large-v3-turbo`
  （入力は base64、`vad_filter`、業界用語の `initial_prompt`）、無ければ従来の外部 API、どちらも無ければ 501
- **注意: `[ai]` があると `wrangler dev` はリモートのプロキシセッションを張る**（Workers AI はローカルでエミュレートされない）。
  ログインしていない環境では dev サーバーの `/api/*` が 500 になる。この sandbox がそれ。ユーザーの PC は `wrangler login` 済みなので動く
- `ServerRecognizer` を書き直し: AudioContext の RMS で VAD（適応ノイズフロア ×3、下限 0.012）。発話後 `silenceSec` の無音で
  クリップ終了 → アップロード → `onResult` → `send()`。`keepAlive` なら次のクリップを自動で開始（PC の常時オンで使える）。
  無音のままなら最大 45 秒で区切る。マイクストリームはクリップ間で持ち回り、`stop()` 後に解放
- `TalkPage`: `engine = 設定が server || (ブラウザ認識なし && Worker に stt あり) ? server : browser`。`useServerStt` が
  `/api/health` の `stt` を 1 回だけ見る。サーバー方式でも push を強制しない（micMode は設定どおり）
- 既定の `sttEngine` を `server` に変更（新規のみ。既存の D1 設定は `browser` のまま → 設定画面で切り替える）
- `*.tsbuildinfo` を git から外した（pull のたびに衝突していた）
- 検証: tsc / vitest 21 / build。Playwright + `--use-file-for-fake-audio-capture`（220Hz の音 2 秒 → 無音）で
  自動選択 → VAD → 40KB アップロード → 発言として表示 を確認。Whisper 本体は未確認（デプロイ後に実機）
- 教訓: `pkill -f "vite --port"` は自分のシェル（コマンド文字列にその語が入る）も殺す。`pgrep -f "[v]ite"` を使う
- 実機報告「話したことと全然違う」（"I press a car" / "Microsoft" / "I ate only Kitty"）。Chrome 内蔵のままか Whisper かは不明。
  切り分け用に **送ったクリップを聞き返す `<audio>`** と **Whisper / Browser のバッジ** を会話画面に出した。
  Whisper 側は `initial_prompt` に **AI の直前の発言** を入れて文脈で補正（`ServerRecognizer.context`）、`beam_size: 5`、
  `condition_on_previous_text: false`。録音は timeslice をやめて 1 クリップ 1 コンテナ
