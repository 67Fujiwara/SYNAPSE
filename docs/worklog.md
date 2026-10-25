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

## 2026-10-19 — Phase 3

- `/api/progress`（`worker/db/progress.ts`）: 365 日ゼロ埋め、週次集計（月曜始まり、語数で重み付けした率）、モード別秒数（30 日）、
  シャドー集計、習得フレーズ。ストリークは `streakDetail`（7 日に 1 回の欠席を forgive、`freezeUsed` を返す）
- ミッション: ダッシュボードの `?mission=` → Talk が `scenario` に課題文を入れる（Worker の `buildChatSystem` は mode に関係なく scenario を付けるよう変更）。
  終了時 20 語以上で `/api/missions/done`（`daily_stats.mission_done`, `bonus_xp` +20、1 日 1 回）
- Level: `estimateLevel`（A2→B1→B2→C1 を飛ばさない。未達条件を列挙）。XP レベルは 100·n²。レーダーは `skillScores`
- グラフは dataviz の基準どおり: モード別は **1 色**（4 色のカテゴリ palette は CVD 検証で不合格だった）、ヒートマップは accent の 5 段階、レーダーは 1 系列
- エクスポート / インポート（`worker/db/transfer.ts`）。R2 があれば `exports/<date>.json` にも置く
- 録音: `ServerRecognizer.onClip` → `send()` で user turn を作った直後に `POST /api/recordings`（設定 `saveRecordings`）。
  **`recordings.turn_id` の FK を外した（0004）**: turn は終了時にしか D1 に入らないので FK 違反になった（ローカルで発覚）。
  レビュー画面の「会話の記録と録音」で再生（認証ヘッダが要るので blob URL 経由）。夜間 cron `0 3 * * *` で `recordingDays` より古い分を削除
- ローカル検証用に `wrangler.local.toml`（`[ai]` 無し、gitignore）。`[ai]` があるとログイン無しの sandbox では dev が 500 になるため
- 検証: tsc / vitest 31 / build（JS 747KB, gzip 229KB）。curl で progress / missions（冪等）/ export→import / recordings。Playwright でダッシュボード → ミッション会話 → 達成 → 進捗ページ
- 未着手: TTS の外部 API 差し替え（任意項目）。Whisper の実機精度は未確認のまま
- 実機報告: 黙っていても "Capture by GetTranscribed.com Capture by GetTranscribed.com" と認識される → **Whisper の無音ハルシネーション**。
  対策 3 段: (1) VAD を厳しく（閾値 0.02 / ノイズ床×4、5 フレーム連続で初めて「声」、声の合計 600ms 未満のクリップは送らない）
  (2) Whisper の `segments[].no_speech_prob` > 0.6 または `avg_logprob` < -1.0 は捨てる、`vad_filter: true` を戻す
  (3) `shared/hallucination.ts` のブロックリスト（字幕の決まり文句・URL・同じ句の繰り返し・単語 1 つの "you" など）。テスト付き
- 実機報告（シャドーイング Overlap）: 話している最中に全部緑で 100%。**スピーカーのお手本をマイクが拾い、それが認識されていた**
  （余計な語がお手本の前半 = 2 重取り）。speechSynthesis は OS 側の再生なので Chrome の AEC では消えない。
  対策: 再生終了まで採点しない、確定待ちを `silenceSec` に合わせる、Overlap/Shadow に「イヤホン推奨」、
  聞こえた語数 ≥ 1.6× かつ余計な語 ≥ 半分 なら「再生音を拾った」として採点しない。
  根本対策の候補: TTS を Workers AI（Chrome が再生する音）に替えれば `echoCancellation` が効く（仕様 11 の TTS 差し替え）

## 2026-10-20 — TTS を Workers AI（Deepgram Aura 2）に差し替え

- 要望: YouTube の話者（若いアメリカ人女性エンジニア、落ち着いた自然な話し方）のような声。本人の声の複製はしない。
  近い系統として米国女性・自然寄りの `luna` を既定に、設定で 40 声を試聴して選べるようにした
- `/api/tts`: `@cf/deepgram/aura-2-en`（`encoding: 'mp3'`）。出力の型は workers-types では `string` だが実体が
  ReadableStream / ArrayBuffer / base64 string / {audio} のどれでも受けるようにした（実機未確認）。R2 に `tts-cache/<sha256(voice|text)>.mp3` でキャッシュ
- `ServerSynthesizer`: speak() ごとに即 fetch（先読み）、再生は必ず順番どおり。`cancel()` は世代カウンタで古いキューを無効化。
  速度は `playbackRate`（Aura に rate は無い）。iOS 用 `unlock()` は無音 WAV を gesture 内で再生
- カラオケはサーバー音声のとき `audio.duration` 比例で単語を進める（`boundary` が無いため）
- 期待効果: speechSynthesis（OS 再生）と違い Chrome が再生する音なので、`echoCancellation: true` のマイクから消える → Overlap/Shadow のスピーカー漏れが減る
- 検証: /api/tts を WAV でモックし、speechSynthesis を消したヘッドレス Chromium で 開幕の一言 → 聞く → 返答 3 文が順に TTS へ → 聞くに戻る、設定の試聴 を確認。
  Aura 本体・音質・エコー消去の効き具合は実機で
- **ハマりどころ**: iOS 解錠用に「データ部が 0 バイトの data-URI WAV」を再生していたら、その後に作った別の Audio 要素が
  `playing` 直後に `pause`（位置 0）で止まり `ended` が来なかった（pause() も load() も呼ばれていないのに）。
  ヘッドレス Chromium で再現。対策: **音声要素は 1 つを使い回し**、解錠はその要素で 100ms の本物の無音 WAV（実行時に生成）を鳴らす。
  ついでに `ended` が来ない場合の保険タイマー（duration + 1.5s）を付けた

## 2026-10-20 — Phase 4: 瞬間英作文（5 段階レベル）

- 要望: 「最も有効な瞬間英作文のやり方」→「進めて。何段階かレベル設定できるように」
- 設計の芯: **お題を見てから最初の一語までの秒数**を主要指標にする（スコアだけだと「ゆっくり考えれば正解」になる）。
  レベルごとに `limitSec`（話し始めの制限）/ `fastSec`（自動化とみなす速さ）/ `passScore` を `shared/instant.ts` の `LEVELS` に持ち、Worker（生成プロンプト）と UI（タイマー・合否・習得）が同じ表を見る
- レベル: Lv1 基礎 (sentence, 6s) / Lv2 文型の切り替え (transform: 英文 + 「疑問文に」, 5s) / Lv3 仕事 (sentence, 4s) / Lv4 場面 (situation: 文を出さず複数正解 + 必須フレーズ, 4s, 合格 60) / Lv5 2 文 (situation, 3s)
- 採点 `src/lib/instant/score.ts`: お手本 + 別解のうち最も近いものと `align`。場面キューは `0.5 × アライメント + 0.5 × 必須フレーズの網羅率`
  （自由回答なので 1 つの文に寄せすぎない）。テスト付き
- 習得 `nextMastered`: 速い合格 +1 / 遅い合格は据え置き / 失敗 0。3 回で「自動化」(★)。間隔反復は `shared/srs.ts` を流用（失敗は翌日）
- 流れ (`Drill.tsx`): マイクは **ラウンド中ずっと ON**（`keepAlive`）。お題表示 → `onSpeechStart`（または最初の結果）で時計を止める →
  確定で採点 → お手本を自動再生 → **リピート 3 回はボタン無し**（result 中に聞こえた文がお手本に 80% 以上一致でカウント、3 回で自動的に次へ）。
  Space / Enter で次へ、Esc でスキップ。サーバー認識は VAD が 250ms 鳴ってから「声」と判定するので、その分を秒数から引く
- 生成 `/api/instant/generate`: Sonnet + `zodOutputFormat`。材料は 直近のレビューの添削 (`fixed`) と better phrases・最新の My Work シナリオ・同レベルの既存の答え（重複回避）。
  テーマ（任意）で絞れる。Whisper の `initial_prompt` にお手本を渡すと採点が甘くなるので渡さない
- 基本セット `src/data/instantbank.ts`（各レベル 8〜10 問）。問題の無いレベルは「始める」で基本セットが自動で入る
- D1 0005: `instant_items` / `instant_attempts`。`/api/progress` に `instant`、エクスポートにも入れた。合格 1 問 +2 XP（`daily_stats.bonus_xp`）
- UI: ナビ 7 項目（モバイルは `grid-cols-7`、390px で「瞬間英作文」が収まるのを確認）。ダッシュボードのカードは「今日やる問題 N 問」
- 検証: tsc / vitest 41 / build（JS 798KB, gzip 244KB。+50KB は Drill/InstantPage/基本セット）。curl で items（不正レベルを捨てる）→ attempts（SRS・mastered・XP）→ progress → export。
  Playwright で レベル一覧 → 基本セット → ラウンド通し（合格 / リピート自動進行 / 時間切れ / スキップ / サマリー）→ AI 生成（モック）→ 進捗 → ダッシュボード → 日本語 UI → モバイル幅
- 未確認: 実機の Whisper 経由の秒数と採点、Aura でのお手本再生、生成の品質。デプロイ側は `npm run db:migrate:remote` で 0005 が要る

## 2026-10-25 — 瞬間英作文の実機フィードバック 5 件

- 要望: (1) 話している言葉を表示 (2) 明らかなノイズを拾わない (3) リピート中の音声が次の画面に漏れて即 NG になる
  (4) リピート 3 回が機能しない (5) リピート画面でも聞こえた内容を出す
- **(3)(4) の根本原因は同じ**: マイクをラウンド中ずっと開けたまま、お手本の TTS 再生中も録音していた。再生音がクリップに混ざって
  Whisper に送られ、(a) お手本そのものが「リピート」として数えられる / 学習者の声と混ざって不一致になる、(b) 「次へ」の瞬間に
  録音中だったクリップが次のお題の答えとして採点される
  - `Recognizer` に `setMuted()` と `discardClip()` を追加（両エンジン）。お手本再生中はミュート（録音中のクリップは捨てる、
    解除時に新しいクリップから始める）。「次へ」で `discardClip()`。サーバー認識の結果には `clipStartedAt` を付け、
    お題を出した時刻より前に始まったクリップの文字起こしは捨てる（アップロード中だった分の対策）
  - 1 クリップに 3 回分入っていても数えられるよう `countRepeats`（答えの語数の窓をスライド）。テスト付き
  - **短縮形は同じ答え**（`expandContractions`: I'm = I am, can't = can not …）。実機で "I'm not" が "I am not" に対し 67% になっていた。
    シャドーイングはリズムが目的なので従来どおり展開しない（`align` 側は変えていない）
- (2) ノイズ: VAD を会話より厳しく（閾値 0.03・6 フレーム = 300ms）。それでも鳴った「声の始まり」に文字が付いてこなかったら
  （Whisper が空を返す = `onClip` の text が空）**お題に戻して時計を再開**（残り時間、最低 1.5 秒）。以前は 'speaking' のまま固まった。
  ブラウザ認識は speechend から 1.5 秒で同じ扱い
- (1)(5) 表示: お題の下に 聞いています… / 文字起こし中… / 残り秒数 とマイクのレベルバー（閾値の半分で色が変わる）。
  聞こえた文はお題カードに大きく出す。リピート欄は聞こえた文ごとに ✓/✗ と一致率の一覧。
  Whisper は話し終えてから文字になる（途中経過は無い）ので、ブラウザ認識のときだけ単語が随時出る
- 検証: vitest 50 / tsc / build。Playwright 2 本: ブラウザ認識（合格 → リピート 3 行 → 自動で次へ → 時間切れ → サマリー）と
  **偽マイク + サーバー認識**（トーンのバースト WAV をマイクに流し `/api/transcribe` をモック）: 聞いています → 文字起こし中 → 100% / 1.1s →
  バースト 3 回で自動的に次へ → 空の文字起こし（ノイズ）で時計が戻る → 「次へ」を録音中に押しても次のお題は NG にならない
- 未確認: 実機でのミュート解除の間（お手本の末尾がクリップに残らないか）、ノイズ閾値 0.03 が静かな部屋の声を落とさないか
