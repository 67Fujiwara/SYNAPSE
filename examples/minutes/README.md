# 議事録ボット用の文字起こし（Whisper on Workers AI、PC 向け）

SYNAPSE の `/api/transcribe` を、長い会議を 45 秒ずつ送る前提に書き直したもの。別アプリに 2 ファイルを貼って使う。

- `worker-transcribe.ts` — Hono のルート `/api/minutes/transcribe`。区切り 1 つを Whisper で文字にし、会議開始からの秒付きで文ごとに返す。用語（`glossary`）と直前の末尾（`prev`）を `initial_prompt` に入れる。無音の幻聴は捨てる
- `client-recorder.ts` — ブラウザ側。マイク + 任意でオンライン会議のタブ音声を 1 本に合成し、45 秒ごとに完結した webm を順番に送る

```
録音（マイク + タブ音声）→ 45 秒ごとに送る → 文字 + 時刻 → 画面に逐次表示 / D1 に追記
会議終了 → 全文を Claude（messages.parse + zodOutputFormat）→ 決定事項 / 宿題 / 担当 / 期限
```

注意:
- Whisper には話者分離が無い。「自分 / 相手」を分けたいなら、マイクとタブ音声を別々の録音にして 2 本送る
- 区切りは `MediaRecorder` の timeslice ではなく stop → start で作る（timeslice の断片はヘッダが無く Whisper が読めないことがある）
- 1 区切りは数百 KB。Whisper の処理は区切りの長さに比例するので 60 秒を超えないようにする
- 用語リストは効く。案件名・人名・製品名を入れる
