# SYNAPSE — Wire your brain for English.

電気・制御エンジニアのための **英語脳トレーニングアプリ**。
アメリカ人の同僚役の AI と声で会話し、話した量・流暢さを自動計測して伸びを見える化する。
仕様の全文は [`docs/SYNAPSE_English_App_Spec.md`](docs/SYNAPSE_English_App_Spec.md)。

```
Frontend : Vite + React 18 + TypeScript + Tailwind   (src/)
Backend  : Cloudflare Workers + Hono                  (worker/)   … Anthropic API キーを隠すプロキシ + D1/R2
DB       : Cloudflare D1 (SQLite)                     (migrations/)
Speech   : Web Speech API (認識・合成) — 差し替え可能な抽象化 (src/lib/speech/)
AI       : Anthropic Messages API (SSE ストリーミング)
```

## 現在の状態: Phase 1〜3 実装済み

| # | 内容 | 状態 |
|---|---|---|
| 1 | 雛形（Pages + Workers + D1 + R2 を Wrangler で一式）、i18n（en/ja）、設定画面 | ✅ |
| 2 | 会話モード: 認識 → ストリーミング返答 → 文単位 TTS、半二重制御、Daily / Business / My Work / Free | ✅ |
| 3 | セッションを D1 に保存、基本メトリクス（分数・語数・WPM・フィラー率・異なり語数・応答レイテンシ） | ✅ |
| 4 | ダッシュボードの目標リング・ストリーク・7 日折れ線、進捗ページ（週/月） | ✅ |
| — | オフライン時は IndexedDB に退避し、復帰後に D1 へ同期（冪等） | ✅ |
| 1.5 | iPhone 準備: 1 URL 配信・PWA・iOS 音声解錠・タップして話すモード（[docs/iphone.md](docs/iphone.md)） | ✅ コード / ⬜ 実機 |
| 1.6 | **サーバー認識（Whisper on Workers AI）**: 既定の認識エンジン。無音検出で自動送信。iPhone Chrome はこれで動く。精度はブラウザ内蔵より上 | ✅ コード / ⬜ 実機 |

| **Phase 2** | | |
| 5 | セッション後レビュー（`claude-opus-5-5`、構造化出力）: 添削（元 → 修正 → 一言理由 → タグ）/ より自然な言い回し 3 つ / 良かった点 / 専門用語チェック。会話終了のサマリーに自動で出る。「シャドーイングに追加」 | ✅ |
| 6 | シャドーイング: 素材（会話・レビュー・フレーズバンク 60 文・手入力）、カラオケ風ハイライト（`boundary` イベント、非対応は文字数比例）、Listen / Overlap / Shadow / Recall、単語アライメント採点（✅ ⚠ ❌、Jaro-Winkler 0.85 で「惜しい」）、リズム加点、間隔反復 1→3→7→14→30 日（70% 未満は翌日） | ✅ |
| 7 | 単語ポップアップ: AI の文の単語をタップ → IPA・品詞・英語の定義・日本語（没入度 High では非表示）・例文、再生（通常 / ゆっくり）、「この文をシャドーイングに保存」 | ✅ |
| 8 | My Work シナリオ生成 | ✅（Phase 1 で実装） |
| — | 日本語字幕（没入度 Low = 常時 / Medium = 「訳」で開く・回数を記録 / High = なし） | ✅ |

| **Phase 3** | | |
| 9 | 進捗: スキルのレーダー（流暢さ / 正確さ / 語彙 / 発音 / 日本語非依存）、1 年のヒートマップ、モード別の練習時間、**Level（CEFR 目安 A2〜C1、次の条件を明示）**、XP レベル、週次レポート（先週比で最も伸びた指標を 1 つ）、今日のミッション（達成で +20 XP）、週次チャレンジ（ビジネス 3 回）、ストリークの freeze（週 1 回の欠席を許容）、マイルストーン、習得したフレーズ | ✅ |
| 10 | フレーズバンク 各 40 文、エクスポート / インポート（`/api/export` は R2 にも控えを保存）、録音の R2 保存と聞き返し（サーバー認識時、設定でオン。夜間 cron で保持期間を過ぎた分を削除） | ✅ |
| 11 | 認識の外部 API 差し替え（Workers AI Whisper / OpenAI 互換 API） | ✅（TTS の差し替えは未着手） |

---

## 起動手順（ローカル）

前提: Node 22+、Chrome / Edge。Cloudflare アカウントは**ローカル開発には不要**（`wrangler dev` が D1/R2 をディスク上でエミュレートする）。

```bash
npm install

# 1) Worker の秘密情報（git 管理外）
cp .dev.vars.example .dev.vars
#    ANTHROPIC_API_KEY=sk-ant-...       ← Anthropic Console で発行
#    ANTHROPIC_WORKSPACE_ID=wrkspc_...  ← キーが sk-ant-usr- 形式のときだけ（Console → Settings → Workspaces の ID）
#    APP_TOKEN=<長いランダム文字列>       ← アプリ側から Bearer で送る合言葉

# 2) D1 のスキーマをローカルに適用
npm run db:migrate:local

# 3) フロント (:5173) と Worker (:8787) を同時起動。/api は Vite が Worker へプロキシする
npm run dev
```

ブラウザで http://localhost:5173 → **Settings → App token** に `.dev.vars` の `APP_TOKEN` を入れて「Test connection」→ Connected。
あとは **Talk** を押してモードを選び、マイクを許可して話す。

> 音声認識は Chrome / Edge のみ。マイク許可は https か localhost でないと出ない。

### よく使うコマンド

```bash
npm run typecheck   # tsc -b（app / worker / node の 3 プロジェクト）
npm test            # vitest（文分割・メトリクス・ストリーク計算）
npm run build       # dist/ を生成
```

---

## デプロイ（Cloudflare）— iPhone から使うにはこれが必要

画面（`dist/`）と API は **同じ Worker** から配信する（`wrangler.toml` の `[assets]`）。デプロイは 1 コマンド、URL も 1 つ。

```bash
npx wrangler login

# D1 を作って wrangler.toml の database_id を差し替える
npx wrangler d1 create synapse-db
npm run db:migrate:remote

# R2 バケット（Phase 3 の録音保存用。今は空でよい。カード登録を避けたければ wrangler.toml の [[r2_buckets]] をコメントアウト）
npx wrangler r2 bucket create synapse-storage

# 秘密情報
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put APP_TOKEN
# キーが sk-ant-usr- 形式なら: npx wrangler secret put ANTHROPIC_WORKSPACE_ID

# ビルドしてデプロイ → https://synapse-api.<account>.workers.dev
npm run deploy
```

iPhone では Safari でその URL を開き、「共有 → ホーム画面に追加」。詳細と実機チェックリストは [`docs/iphone.md`](docs/iphone.md)。

デプロイ前にローカルで本番と同じ形を試す: `npm run preview:worker`（ビルドして Worker 1 本で :8787 に配信）。

---

## 使い方のポイント

- **AI は 2〜3 文で返し、必ず質問で終わる**（あなたが話す時間を最大化する設計）。長く話してよい。
- **会話中は直されない。** 間違いは AI が自然に言い直して返す（recast）。添削は Phase 2 のレビューで。
- **1.2 秒黙ると送信**（設定で変更 / 手動送信モードあり）。AI が話している間はマイクが止まる（半二重）。
  **AI が話している途中で画面をタップすると割り込める**。
- **没入度 High（既定）** では日本語で話しても英語で返ってくる。つらければ Medium / Low に。
- **My Work**: 自分の案件を 1〜3 行書く（日本語可）→ 相手の役割・状況・ゴールを AI が作って開始。
- **モデル**: 会話は速度重視 `claude-sonnet-5-5`（既定）、レビューは `claude-opus-5-5`、字幕・単語は `claude-haiku-5-5`。設定で変更可。
- **音声認識は 2 方式**（設定 → 音声入力 → 認識エンジン）: **サーバー（Whisper on Cloudflare、既定）** は精度が高く iPhone Chrome でも動くが、
  文字は黙ってから 1〜2 秒後に出る。**ブラウザ** は話しながら文字が出るが非ネイティブの発音に弱い。
  ローカル開発でサーバー方式を使うには `npx wrangler login` 済みであること（Workers AI はローカルでエミュレートされず、`wrangler dev` が実物を呼ぶ）。

---

## 動作確認チェックリスト（Phase 3）

- ✅ `/api/progress` が 365 日分・週次集計・モード別・シャドー集計・習得フレーズを返す。ストリークは週 1 回の欠席を freeze で許容（テスト付き）
- ✅ `/api/missions/done` は 1 日 1 回だけ +20 XP（2 回目は `newly:false`）
- ✅ `/api/export` → `/api/import` の往復でセッション・シャドーイング・日次が戻る
- ✅ `/api/recordings` に音声を置いて一覧・取得できる（ローカル R2）。夜間 cron の purge はコードのみ
- ✅ ブラウザ: ダッシュボードの週次カード・チャレンジ・レベル → ミッション付き会話 → 20 語以上で「達成 +20 XP」→ 進捗ページ（レーダー / ヒートマップ / マイルストーン）
- ⬜ 実機で録音の保存（設定オン）→ レビュー画面の再生
- ⬜ Cloudflare の cron が動くか（Workers ダッシュボードの Triggers に表示される）

## 動作確認チェックリスト（Phase 2）

- ✅ `/api/shadow/items` は同じ文を重複登録しない。`/api/shadow/attempts` で 70% 未満は翌日、以上は 1→3→7→14→30 日に伸びる。Recall で 90% 以上が続くと習得カウントが増える
- ✅ 採点ロジック（正規化 / Jaro-Winkler / アライメント / 間隔反復）のユニットテスト 7 件
- ✅ ブラウザ: フレーズバンク追加 → 練習 → 発話 → 単語ごとの色分けとスコア → 保存。レビュー画面の表示と「シャドーイングに追加」。会話中の単語タップ → ポップアップ。終了 → サマリーに良かった点と直す Top3
- ⬜ 実機で本物のレビューを 1 回生成し、添削の質（直訳の専門用語を拾うか）を見る
- ⬜ iPhone の Safari でカラオケのハイライトが動くか（`boundary` 非対応なら文字数比例に落ちる）

## 動作確認チェックリスト（Phase 1）

実機（PC Chrome）で確認する項目。✅ は本リポジトリのテスト / ヘッドレス走行で確認済み、⬜ はマイク付きの実機で確認する。

- ✅ `npm run typecheck` / `npm test` / `npm run build` が通る
- ✅ Worker: 未認証は 401、`/api/health` が `hasKey` を返す
- ✅ `/api/sessions` は同じ id を 2 回送っても日次集計が二重にならない（オフライン再送に備える）
- ✅ `/api/stats` が 7 日分をゼロ埋めで返し、ストリークが「昨日まで連続」でも途切れない
- ✅ `/api/chat` は SSE で `text` / `done` / `error` を返す（キーが不正なら `error` を 1 行）
- ✅ UI 言語を日本語にすると全ラベルが翻訳される（ダッシュボード / 会話 / 設定）
- ✅ 設定は D1 に保存され、再読み込み・別端末でも同じ値になる
- ✅ セッション終了 → サマリー（分数・語数・WPM・フィラー・異なり語数・XP）→ ダッシュボードに反映
- ⬜ 話し始めてから 300ms 以内に暫定テキスト（薄い色）が出る
- ⬜ AI の 1 文目の読み上げが 2 秒以内に始まる
- ⬜ TTS 再生中に自分の声（スピーカー音）が誤認識されない
- ⬜ 没入度 High で AI が日本語を一切出さない
- ⬜ Wi-Fi を切った状態でセッションを終えても、復帰後にダッシュボードへ同期される

---

## フォルダ構成

```
worker/
  index.ts          Hono: /api/chat (SSE) /api/scenario /api/translate /api/review /api/word /api/shadow/* /api/transcribe /api/sessions /api/stats /api/settings /api/data
  db/               D1 クエリ層（sessions / stats / settings / reviews / shadow）
  prompts/*.md      システムプロンプト（会話・没入度・モード・シナリオ生成・字幕・レビュー・単語）— 編集してよい
shared/srs.ts       間隔反復（Worker と app で共用）
  db/               D1 クエリ層（sessions / stats / settings）
  prompts/*.md      システムプロンプト（共通 / 没入度 3 段 / モード 4 種 / シナリオ生成）— コードから分離。編集してよい
migrations/         D1 マイグレーション
shared/types.ts     フロントと Worker で共有する型
src/
  app/              ルーティング・ナビ
  features/conversation/  会話（useConversation = 半二重の中核、Transcript、Waveform、SummaryCard、TalkPage）
  features/progress/      ダッシュボード・進捗（GoalRing、MinutesChart）
  features/settings/      設定（SettingsProvider = localStorage 即時 + D1 へ遅延保存）
  features/review/        レビュー（一覧・表示・未レビューのセッションから生成。ReviewView はサマリーでも使う）
  features/shadowing/     シャドーイング（デッキ・練習・カラオケ）
  lib/align/        シャドーイングの採点（正規化・Jaro-Winkler・Levenshtein アライメント）
  data/phrasebank.ts  フレーズバンク（日常 / ビジネス / 電気制御 各 20 文、日本語付き）
  lib/speech/       Recognizer / Synthesizer の抽象化、Web Speech 実装、サーバー認識 (MediaRecorder → /api/transcribe)、文分割、マイク波形、iOS 判定
  lib/metrics/      語数 / WPM / フィラー / 異なり語数
  lib/api/          Worker クライアント（SSE リーダー含む）
  lib/db/           IndexedDB（オフラインの一時キャッシュ・送信待ちキュー）
  lib/sync.ts       送信待ちセッションの同期ループ
  i18n/             en.json / ja.json
```
