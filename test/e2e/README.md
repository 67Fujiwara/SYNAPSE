# ブラウザ通しテスト（Playwright）

`npm run dev`（または `wrangler dev -c wrangler.local.toml` + `vite`）を立てた状態で、`playwright-core` が入った場所から実行する。
Chromium は `CHROME_PATH` か `PLAYWRIGHT_BROWSERS_PATH` から探す。`TOKEN` は `.dev.vars` の `APP_TOKEN`。

```
node test/e2e/make_wav.mjs /tmp/bursts.wav                     # 偽マイク用の「声」（周波数スイープ + 4Hz の包絡）
node test/e2e/personas.mjs  /tmp/shots $TOKEN                  # 会話: 13 場面（速い人・間の長い人・フィラー・割り込み・iPhone・手動送信・API 障害・30 往復・ミッション/My Work・途中終了・認識の不調・マイク無し・ノイズ退避）
node test/e2e/personas2.mjs /tmp/shots $TOKEN                  # オフライン同期・誤トークン・シャドーイング・レビュー + 単語ポップアップ・日本語 UI・設定の永続化
node test/e2e/conv_noise.mjs       /tmp/shots /tmp/bursts.wav $TOKEN   # 常時オン + 感度「低」+ ノイズ → タップして話すへ退避
node test/e2e/conv_push_server.mjs /tmp/shots /tmp/bursts.wav $TOKEN   # iPhone の本番経路: タップして話す + Whisper（偽マイク）
node test/e2e/instant_server.mjs   /tmp/shots /tmp/bursts.wav $TOKEN   # 瞬間英作文: Whisper 経路（リピート自動進行・ノイズで時計が戻る・「次へ」の漏れ無し）
node test/e2e/instant.mjs          /tmp/shots $TOKEN                   # 瞬間英作文: ブラウザ認識経路
```

`personas*.mjs` は第 3 引数に場面名（カンマ区切り）を渡すと絞れる。AI の API はすべてモック（鍵不要）。
