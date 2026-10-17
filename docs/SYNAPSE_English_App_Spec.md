# SYNAPSE — 電気・制御エンジニアのための英語脳トレーニングアプリ 仕様書

> Claude Code への実装依頼書。この1ファイルを読めば設計の意図・画面・アルゴリズム・技術構成がすべて分かる状態にしてある。
> アプリ名「SYNAPSE」＝英語脳の神経接続。タグライン案："Wire your brain for English."

---

## 0. このアプリのゴール

| ゴール | アプリでの実現方法 |
|---|---|
| 外国人と英語で日常会話ができる | 日常会話モード（アメリカ人の自然な口語）での毎日の実戦 |
| 仕事（電気設計・制御・ソフト）でビジネス会話ができる | 職種特化シナリオ（仕様打合せ、PLCベンダー対応、トラブル報告、海外工場立上げ など） |
| 英語がメイン言語になる・英語脳になる | 没入度設定（日本語を極力消す）、英語で言い換える訓練、「日本語を経由しない」設計 |
| 成長が見えてモチベが続く | 発話量・精度・流暢さを自動計測し、グラフ・ストリーク・週次レポートで可視化 |

やらないこと：単語暗記（別アプリで行う）。ただし会話中に出た単語の発音・意味はその場で確認できる（DeepL風ポップアップ）。

---

## 1. 専門家パネルの結論（設計判断の根拠）

実装前に以下の5名の視点で議論し、出た結論を設計に落とし込んだ。Claude Code はこの判断を尊重すること。

**A. 英会話指導のプロ（ネイティブ講師）**
- 上達の最大要因は「発話総量」。アプリの最重要KPIは *speaking minutes* と *words spoken*。
- 会話を途中で止めて直すと萎縮する。添削は「セッション後」にまとめて、会話中は流れを止めない。
- ただし致命的な誤解だけは、AI側が会話の中で自然に言い直して返す（recast）。これはネイティブが実際にやっていること。

**B. アメリカ人（一般）**
- 教科書英語は実際の会話で浮く。AIのペルソナは「アメリカ西海岸の普通の同僚」。縮約形（gonna, wanna）、相槌（Oh nice, Gotcha, No way）、スモールトークを含む。
- 日本人が苦手なのは「会話を続ける力」。AIは質問で終わる返答を基本にし、ユーザーが話す時間を最大化する。

**C. 電気・制御設計のアメリカ人エンジニア**
- 実務で使う英語はパターンが決まっている：仕様確認、納期交渉、トラブルシュート報告、安全（E-stop, interlock, LOTO）、図面レビュー、ベンダーとの打合せ。
- 専門用語は「日本語の直訳」が通じない代表例を潰すと効果が大きい（例：盤→ control panel / enclosure、端子台→ terminal block、配線→ wiring/harness、ラダー→ ladder logic、タッチパネル→ HMI、三菱/キーエンス→ 相手は Allen-Bradley/Siemens 前提で話す）。
- ビジネスシナリオは「ユーザーの実際の案件」を入力して即席で作れるべき。汎用台本より自分の仕事の方が何倍も身につく。

**D. 英会話を教えている日本人**
- 日本人がつまずくのは「日本語で考えてから訳す」こと。英語脳化のコアは *言い換え訓練*：言えなかった内容を、簡単な英語で説明させる（「説明できれば訳さなくていい」）。
- 日本語表示は「完全に消す」のではなく「隠しておいて必要な時だけ出す」。安心感が継続を生む。
- シャドーイングは「意味が分かる文」でないと効果が薄い。会話で実際に出た文をシャドーイング素材に回すのが最も効率的。

**E. アルゴリズム・音声処理エンジニア**
- リアルタイム文字起こしはブラウザの Web Speech API（Chrome）で十分実用。`interimResults` で暫定テキストを即表示し、確定後に置換する「2段表示」が体感速度の鍵。
- AI返答は **ストリーミング** で受け取り、文単位に区切って TTS に流す。「文字が出るのと声が出るのが同期して見える」ことがリアルタイム感を決める。
- シャドーイング採点は「正規化 → 単語列の DP アライメント（Levenshtein）」で十分。音素レベルの採点は精度が不安定なので v1 では見送り、v2 で検討。
- マイクが自分の TTS を拾う問題：TTS 再生中は認識を一時停止し、再生終了後に再開（半二重）。これで誤認識を大幅に減らせる。

**パネル全体の最終合意：**
1. 「話した量」が増える設計を最優先（AIは短く返し、質問で終わる）。
2. 添削はセッション後、言い換え訓練はセッション中。
3. 会話 → シャドーイング素材 → 進捗グラフ、が1本の流れでつながること。
4. 英語脳化のために UI も英語がデフォルト。日本語は設定でいつでも出せる。
5. v1 は「ブラウザ機能だけで動く最小構成」で完成させ、有料API（高品質TTS/Whisper）は差し替え可能な設計にする。

---

## 2. 技術構成

```
Frontend : Vite + React 18 + TypeScript + Tailwind CSS
UI補助   : framer-motion（アニメーション）, lucide-react（アイコン）, recharts（グラフ）
音声入力 : Web Speech API (SpeechRecognition, continuous + interimResults)
音声出力 : Web Speech API (SpeechSynthesis)  ※ v2 で OpenAI TTS / ElevenLabs に差し替え可能なインターフェースにする
AI       : Anthropic Messages API（ストリーミング）
Backend  : Cloudflare Workers + Hono（APIキーを隠すプロキシ、SSE中継、D1/R2 アクセス）
DB       : Cloudflare D1（SQLite）— セッション、ターン、レビュー、シャドーイング、統計、設定
Storage  : Cloudflare R2 — 録音音声（自分の発話）、TTS キャッシュ、エクスポートJSON、フレーズバンク
Hosting  : Cloudflare Pages（フロント）+ Workers（API）。Wrangler でデプロイ
ローカル : IndexedDB は「オフライン時の一時キャッシュ」のみ。正本は D1
対象環境 : PC Chrome 優先。スマホ Chrome でも動くレスポンシブ設計
```

**環境変数 / バインディング**（`wrangler.toml`）
- `ANTHROPIC_API_KEY`：Workers の secret（`wrangler secret put`）。クライアントに露出させない
- `DB`：D1 バインディング
- `BUCKET`：R2 バインディング
- `APP_TOKEN`：個人利用のため簡易認証。クライアントは Bearer トークンを送り、Workers で検証する（公開URLでも他人に使われないように）

**R2 に保存するもの**
- `recordings/{sessionId}/{turnId}.webm`：自分の発話の録音（MediaRecorder）。レビュー画面で聞き返し、シャドーイングで参照音声と聞き比べる
- `tts-cache/{hash}.mp3`：v2 で外部TTSを使う場合のキャッシュ（同じ文を二度生成しない）
- `exports/{date}.json`：バックアップ
- `banks/*.json`：フレーズバンク（アプリ外から追加できるように）

**D1 の方針**
- マイグレーションは `migrations/*.sql` で管理（`wrangler d1 migrations apply`）
- クライアントは D1 を直接触らない。すべて Workers の `/api/*` 経由
- 書き込みはセッション終了時にまとめて送る（会話中はローカルに貯め、ネットワーク断でも失わない）
**モデル**：会話は応答速度重視のモデル、セッション後レビューは高精度モデル、の2段構えにする（設定で変更可）。

### フォルダ構成（目安）

```
synapse/
├─ worker/
│  ├─ index.ts            # Hono: /api/chat (SSE), /api/review, /api/sessions, /api/shadow, /api/stats, /api/recordings
│  ├─ db/                 # D1 クエリ層
│  ├─ storage/            # R2 アクセス層（署名URL発行など）
│  └─ prompts/            # システムプロンプト（モード別）
├─ migrations/            # D1 マイグレーション SQL
├─ wrangler.toml
├─ src/
│  ├─ app/                # ルーティング、レイアウト
│  ├─ features/
│  │  ├─ conversation/    # 会話モード
│  │  ├─ shadowing/       # シャドーイング
│  │  ├─ review/          # セッション後レビュー
│  │  ├─ progress/        # ダッシュボード・グラフ
│  │  └─ settings/
│  ├─ lib/
│  │  ├─ speech/          # recognition.ts, synthesis.ts（差し替え可能な抽象化）
│  │  ├─ align/           # シャドーイング採点アルゴリズム
│  │  ├─ metrics/         # WPM, fillers, 語彙数など
│  │  ├─ api/             # Workers API クライアント（fetch ラッパー）
│  │  └─ db/              # IndexedDB（オフライン一時キャッシュ）
│  ├─ i18n/               # en.json, ja.json
│  └─ components/ui/      # 共通UI
└─ README.md
```

---

## 3. 画面と機能

### 3.1 ホーム（Dashboard）
- 上部：今日の目標達成リング（例：10分中 6分）、ストリーク（🔥 12 days）
- 「Today's Mission」カード：1日1つの課題（例："Explain what an interlock is in 3 sentences"）。達成でボーナスXP
- 主要ボタン：**Talk**（会話）/ **Shadow**（シャドーイング）/ **Review**（前回の添削）
- 直近7日のミニグラフ（発話分数）

### 3.2 会話モード（Talk）

**レイアウト**
- 中央：トランスクリプト（チャット形式ではなく「字幕」風。AIの発言は大きく、自分の発言は少し小さく）
- 下部：マイク状態の波形ビジュアライザー（Web Audio API の AnalyserNode）。話していると波が動く
- 右（PC）/ 下スワイプ（スマホ）：ヒントパネル（後述）

**会話の流れ**
1. モード選択：`Daily`（日常）/ `Business`（ビジネス汎用）/ `My Work`（自分の案件から即席シナリオ）/ `Free`（自由）
2. `My Work` は、案件の概要を英語または日本語で1〜3行入力 → AIがシナリオ（相手の役割・状況・ゴール）を生成して開始
3. マイク常時ON（continuous）。暫定テキストは薄い色で即表示、確定で濃い色に置換
4. 発話が1.2秒止まったら送信（設定で変更可。手動送信ボタンも用意）
5. AI返答はストリーミング表示。文が確定するごとに TTS で読み上げ。読み上げ中は認識停止（半二重）
6. ユーザーは AI の読み上げ中でもタップで割り込み可能（TTS停止 → 認識再開）

**AIの振る舞い（システムプロンプトの要点）**
- ペルソナ：アメリカ人の同僚/取引先。自然な口語。1返答は2〜3文、必ず質問か話題振りで終える
- ユーザーの英語が多少おかしくても会話を止めず、自然な形で言い直して返す（recast）
- ユーザーが詰まったら（"um..." が続く/無音が長い）：`Keep going — you can say it simply.` のような一言で促す
- 日本語で話しかけられたら：英語で "Try that in English — even just the key words." と返す（没入度 High の場合）。没入度 Low なら日本語を英訳して提示してから続ける
- ビジネスモードでは専門用語を正しい業界英語で使う（control panel, terminal block, ladder logic, HMI, PLC I/O, E-stop, interlock, commissioning, FAT/SAT, drawing revision など）

**ヒントパネル（英語脳化の核心）**
- `Say it differently`：今の自分の発言を、AIがより自然な1文に言い換えて表示（会話は止めない。見たい時だけ見る）
- `I don't know the word`：言いたい概念を簡単な英語で説明するよう促すテンプレ（"It's a thing that..." / "It's like... but..."）。日本語入力は最後の手段として隠しボタンに
- 単語タップ → **DeepL風ポップアップ**：発音記号（IPA）、🔊再生（通常/ゆっくり）、品詞、短い英語の定義、（設定で）日本語訳、例文1つ。「Save to shadowing」ボタン

**セッション終了時**
- 自動で `Review` を生成（後述）し、サマリーカードを表示（話した時間、語数、WPM、今日の良かった表現 1つ、直すべき表現 Top3）

### 3.3 シャドーイング（Shadow）

**素材の出どころ**
1. 直前の会話で AI が話した文（意味が分かっているので最も効果的）
2. 自分が言えなかったことの「言い換え後の文」
3. 職種別フレーズバンク（内蔵：日常 150文 / ビジネス 150文 / 電気制御 150文。段階的に増やす）
4. 自分で入力した文

**練習フロー**
1. 文を表示（最初は英語のみ。長押しで日本語訳）
2. ▶ 再生：読み上げに合わせて単語がカラオケ風にハイライト（SpeechSynthesis の `boundary` イベントを使用。非対応環境は文字数比例で近似）
3. モード：`Listen`（聞くだけ）→ `Overlap`（同時に言う）→ `Shadow`（少し遅れて言う）→ `Recall`（文を隠して言う）
4. 発話を認識して採点（アルゴリズムは §4.2）
5. 結果：単語ごとに ✅ / ⚠（置換）/ ❌（抜け）で色分け。スコア%、自分の WPM と目標 WPM、連続正解数
6. 70%未満の文は「要復習」に自動登録。間隔反復（1日→3日→7日→14日）で再出題

**速度設定**：0.7x / 0.85x / 1.0x / 1.15x。ネイティブ速度に段階的に上げる

### 3.4 レビュー（Review）
会話セッション後に高精度モデルで生成。
- `Corrections`：元の発言 → 修正文 → 一言理由（英語。設定で日本語併記）。文法/語彙/自然さ のタグ付け
- `Better phrases`：その場面でネイティブが使う言い回し 3つ
- `Your wins`：良かった表現を必ず1つ褒める（継続のため）
- `Add to shadowing` ボタン（修正文をワンタップで素材化）
- 専門用語チェック：直訳っぽい技術用語があれば業界標準の言い方を提示

### 3.5 進捗（Progress）

**記録するメトリクス**（セッション毎に保存）

| 指標 | 計算 | 意味 |
|---|---|---|
| Speaking minutes | 認識が音声を捉えていた合計時間 | 発話総量（最重要） |
| Words spoken | 確定トランスクリプトの語数 | 発話総量 |
| WPM | words / speaking minutes | 流暢さ |
| Filler rate | (um, uh, like, you know, えーと) / 100 words | 流暢さ |
| Error rate | Review の修正数 / 100 words | 正確さ |
| Unique words | セッション内の異なり語数（レンマ化は簡易） | 語彙の幅 |
| Avg sentence length | 語数 / 文数 | 複雑さ |
| Response latency | AI発話終了→自分の発話開始までの平均秒 | 英語脳度（考える時間の短さ） |
| Shadowing accuracy | §4.2 のスコア平均 | 発音・リズム |
| Shadowing WPM reach | 達成できた最高速度 | リスニング/発話速度 |
| JP hint usage | 日本語ヒントを開いた回数 | 英語脳度（減るほど良い） |

**グラフ（recharts）**
- 折れ線：Speaking minutes / WPM / Error rate / Response latency の推移（週・月切替）
- レーダー：Fluency / Accuracy / Vocabulary / Pronunciation(Shadow) / Independence(JPヒント非依存) の5軸
- ヒートマップ：GitHub風の活動カレンダー（1年分）
- 棒グラフ：モード別の練習時間（Daily / Business / My Work / Shadow）
- 「Level」表示：上記を合成した CEFR 目安（A2〜C1）。到達条件を明示して次の目標を見せる

**モチベーション設計**
- ストリーク（1日1セッションで継続。週1回の「freeze」で救済）
- 毎日のミッション + 週次チャレンジ（例："Do 3 business sessions this week"）
- XPとレベルアップ演出（控えめに。派手すぎない）
- 週次レポート：日曜にダッシュボードに「This week」カード（伸びた指標を1つ強調）
- マイルストーン通知："You've spoken 10,000 words in English" など
- 「Phrases you mastered」一覧（Recall モードで3回連続成功した文）

### 3.6 設定（Settings）
- UI language：English（デフォルト）/ 日本語
- Immersion level：High（日本語ヒント非表示・日本語入力に英語で返す）/ Medium（日本語は長押しで表示）/ Low（併記）
- AI voice / accent、読み上げ速度
- 無音判定秒数、手動送信モード
- 1日の目標分数
- モデル選択（会話用/レビュー用）
- データのエクスポート（R2 にJSON保存 + ダウンロード）/インポート、全消去
- 録音を保存するか（ON/OFF）、録音の保持期間

---

## 4. アルゴリズム詳細

### 4.1 リアルタイム文字起こし
```
SpeechRecognition:
  lang = 'en-US', continuous = true, interimResults = true, maxAlternatives = 1

onresult:
  interim 部分 → 薄い色で末尾に表示（毎イベントで置換）
  final 部分   → 確定テキストに追加。speakingSegments に (start, end) を記録

無音検出:
  final が来てから N 秒（既定1.2）新しい interim が来なければ送信

半二重制御:
  TTS開始 → recognition.stop()
  TTS終了 → recognition.start()（Chromeは数分で自動停止するため onend で再start するウォッチドッグを入れる）

Speaking minutes:
  onspeechstart / onspeechend の間隔を合計。取れない環境では final 到着間隔から近似
```

### 4.2 シャドーイング採点（単語アライメント）
```
normalize(text):
  小文字化、句読点除去、数字→語（"3"→"three"）、縮約の展開は行わない（"gonna" はそのまま比較）
  同音・表記ゆれ辞書で正規化（ok/okay, gonna/going to は等価扱い）

align(ref[], hyp[]):
  Levenshtein DP（置換/挿入/削除コスト1）でバックトレース
  各 ref 単語に match / substitute / missing を付与
  substitute は Jaro-Winkler 類似度 >= 0.85 なら "近い"（⚠）、未満は ❌

score = matches / len(ref) * 100
timing bonus: 自分の発話時間が参照音声の ±20% 以内なら +5（リズム評価）
```

### 4.3 AI返答のストリーミングとTTS同期
```
SSE で token 受信 → バッファに追加
文末判定（. ! ? または改行）で1文確定 → TTSキューに投入
画面は token 単位で即描画、TTS は文単位で順次再生
ユーザー割り込み → speechSynthesis.cancel() + キュー破棄 + 認識再開
```

### 4.4 フィラー検出
英語：um, uh, er, hmm, like（文頭/連続時のみ）, you know, I mean
日本語：えーと, あの, その（認識が拾った場合）
※ 単純な語一致でよい。精度より傾向の可視化が目的

---

## 5. データモデル（D1 テーブル。IndexedDB のキャッシュも同じ形）

```ts
sessions: { id, mode, startedAt, endedAt, speakingSec, words, wpm, fillerRate,
            errorRate, uniqueWords, avgSentLen, avgLatencySec, jpHintCount, xp }
turns:    { id, sessionId, role: 'user'|'ai', text, startedAt, endedAt }
reviews:  { id, sessionId, corrections: [{original, fixed, reason, tag}],
            betterPhrases: string[], wins: string[] }
shadowItems: { id, text, source: 'conversation'|'review'|'bank'|'manual',
               jaText?, dueAt, interval, bestScore, bestWpm, masteredCount }
shadowAttempts: { id, itemId, at, score, wpm, speed }
dailyStats: { date, speakingSec, words, sessions, missionDone, streak }
settings:  { uiLang, immersion, voice, rate, silenceSec, dailyGoalMin, models }
recordings: { id, turnId, r2Key, durationSec, createdAt }   // 音声本体は R2
```
日付は ISO 文字列（UTC）で保存し、表示時にローカルに変換する。

---

## 6. デザイン方針（モダンでかっこよく）

- ダークテーマがデフォルト（ライトも用意）。背景 `#0B0F14` 系、アクセントは電気を連想する **エレクトリックシアン**（`#22D3EE`）+ 成功時のライム
- フォント：見出し `Space Grotesk`、本文 `Inter`、トランスクリプトはやや大きめ（PC 20px / スマホ 18px）で可読性最優先
- 余白を広く、カードは薄いボーダー + 微細なグラデーション。ガラス風は控えめに
- マイク波形、ストリーミング文字、カラオケハイライト、スコア表示——動きは「情報を伝える動き」だけにする。無意味な装飾アニメは禁止
- 会話画面は没入重視：ナビを隠し、トランスクリプトと波形だけ。終了ボタンは右上に小さく
- ダッシュボードは「今日やること1つ」が最初に目に入る構成

---

## 7. 実装フェーズ

**Phase 1（MVP・まずこれを完成させる）**
1. プロジェクト雛形（Pages + Workers + D1 + R2 を Wrangler で一式）、i18n（en/ja）、設定画面
2. 会話モード：認識 → ストリーミング返答 → TTS、半二重制御、Daily/Business/Free
3. セッションを D1 に保存、基本メトリクス（分数・語数・WPM）
4. ダッシュボードの目標リング・ストリーク・折れ線1本

**Phase 2**
5. セッション後レビュー（Corrections / Better phrases / Wins）
6. シャドーイング（素材化・カラオケ・採点・間隔反復）
7. DeepL風単語ポップアップ
8. My Work シナリオ生成

**Phase 3**
9. 全グラフ（レーダー・ヒートマップ・モード別）、Level、週次レポート、ミッション
10. フレーズバンク拡充、エクスポート/インポート、録音の R2 保存と聞き返し
11. TTS/認識の外部API差し替え（任意）

各フェーズ終了時に動作確認用のチェックリストを README に残すこと。

---

## 8. 受け入れ条件（MVP）

- [ ] PC Chrome で、話し始めてから 300ms 以内に暫定テキストが画面に出る
- [ ] AI の返答が1文目から読み上げ開始まで 2秒以内
- [ ] TTS 再生中に自分の声が誤認識されない（半二重が機能）
- [ ] 10分の会話セッションを完了し、分数・語数・WPM が保存・グラフ表示される
- [ ] UI 言語を日本語に切り替えても全ラベルが翻訳される
- [ ] 没入度 High でAIが日本語を一切出さない
- [ ] ブラウザを閉じて開き直しても、別の端末からでも、同じデータが D1 から表示される
- [ ] ネットワーク断の最中に終えたセッションが、復帰後に D1 へ同期される

---

## 9. Claude Code への補足指示

- Web Speech API は Chrome 以外で挙動が違う。`lib/speech/` に抽象インターフェース（`Recognizer`, `Synthesizer`）を切り、実装を差し替えられるようにする
- API キーは必ず Workers 側。クライアントに `ANTHROPIC_API_KEY` を渡すコードは書かない
- Workers から Anthropic API を呼ぶ際はレスポンスをそのままストリーム転送する（Workers 内でバッファしない）
- D1/R2 はローカル開発でも `wrangler dev` でエミュレートできる。`--remote` 不要で動く構成にする
- システムプロンプトは `worker/prompts/*.md` に置き、コードから分離してユーザーが編集できるようにする
- 会話用プロンプトには「返答は2〜3文、必ず質問で終える、専門用語の業界標準表記リスト」を含める
- まず Phase 1 を動く状態で納品してから次へ進む。1フェーズごとに起動手順を README に追記する
