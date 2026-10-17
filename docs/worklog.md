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
