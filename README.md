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

## 現在の状態: Phase 1（MVP）実装済み

| # | 内容 | 状態 |
|---|---|---|
| 1 | 雛形（Pages + Workers + D1 + R2 を Wrangler で一式）、i18n（en/ja）、設定画面 | ✅ |
| 2 | 会話モード: 認識 → ストリーミング返答 → 文単位 TTS、半二重制御、Daily / Business / My Work / Free | ✅ |
| 3 | セッションを D1 に保存、基本メトリクス（分数・語数・WPM・フィラー率・異なり語数・応答レイテンシ） | ✅ |
| 4 | ダッシュボードの目標リング・ストリーク・7 日折れ線、進捗ページ（週/月） | ✅ |
| — | オフライン時は IndexedDB に退避し、復帰後に D1 へ同期（冪等） | ✅ |

Phase 2（レビュー / シャドーイング / 単語ポップアップ）は未着手。ナビには枠だけある。

---

## 起動手順（ローカル）

前提: Node 22+、Chrome / Edge。Cloudflare アカウントは**ローカル開発には不要**（`wrangler dev` が D1/R2 をディスク上でエミュレートする）。

```bash
npm install

# 1) Worker の秘密情報（git 管理外）
cp .dev.vars.example .dev.vars
#    ANTHROPIC_API_KEY=sk-ant-...       ← Anthropic Console で発行
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

## デプロイ（Cloudflare）

```bash
npx wrangler login

# D1 を作って wrangler.toml の database_id を差し替える
npx wrangler d1 create synapse-db
npm run db:migrate:remote

# R2 バケット（Phase 3 の録音保存用。今は空でよい）
npx wrangler r2 bucket create synapse-storage

# 秘密情報
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put APP_TOKEN

# API
npm run deploy:api            # → https://synapse-api.<account>.workers.dev

# フロント（Pages）。/api を Worker に向けるため、Pages 側で Service binding か
# `_redirects` のプロキシを設定する（例: /api/* → Worker の URL）
npm run deploy:web
```

フロントと API を別ホストに置く場合は、`src/lib/api/client.ts` の相対パス `/api` を Worker の URL に変えるか、
Pages の `_redirects` で `/api/* https://synapse-api.<account>.workers.dev/api/:splat 200` を書く。

---

## 使い方のポイント

- **AI は 2〜3 文で返し、必ず質問で終わる**（あなたが話す時間を最大化する設計）。長く話してよい。
- **会話中は直されない。** 間違いは AI が自然に言い直して返す（recast）。添削は Phase 2 のレビューで。
- **1.2 秒黙ると送信**（設定で変更 / 手動送信モードあり）。AI が話している間はマイクが止まる（半二重）。
  **AI が話している途中で画面をタップすると割り込める**。
- **没入度 High（既定）** では日本語で話しても英語で返ってくる。つらければ Medium / Low に。
- **My Work**: 自分の案件を 1〜3 行書く（日本語可）→ 相手の役割・状況・ゴールを AI が作って開始。
- **モデル**: 会話は速度重視 `claude-sonnet-5-5`（既定）、レビュー（Phase 2）は `claude-opus-5-5`。設定で変更可。

---

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
  index.ts          Hono: /api/chat (SSE) /api/scenario /api/sessions /api/stats /api/settings /api/data
  db/               D1 クエリ層（sessions / stats / settings）
  prompts/*.md      システムプロンプト（共通 / 没入度 3 段 / モード 4 種 / シナリオ生成）— コードから分離。編集してよい
migrations/         D1 マイグレーション
shared/types.ts     フロントと Worker で共有する型
src/
  app/              ルーティング・ナビ
  features/conversation/  会話（useConversation = 半二重の中核、Transcript、Waveform、SummaryCard、TalkPage）
  features/progress/      ダッシュボード・進捗（GoalRing、MinutesChart）
  features/settings/      設定（SettingsProvider = localStorage 即時 + D1 へ遅延保存）
  lib/speech/       Recognizer / Synthesizer の抽象化、Web Speech 実装、文分割、マイク波形
  lib/metrics/      語数 / WPM / フィラー / 異なり語数
  lib/api/          Worker クライアント（SSE リーダー含む）
  lib/db/           IndexedDB（オフラインの一時キャッシュ・送信待ちキュー）
  lib/sync.ts       送信待ちセッションの同期ループ
  i18n/             en.json / ja.json
```
