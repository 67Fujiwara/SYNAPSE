// Starter phrase bank (§3.3 of the spec). Grows over time; keep each line short and spoken.
import type { NewShadowItem } from '@shared/types';

export interface BankEntry {
  en: string;
  ja: string;
}

export const BANK: Record<'daily' | 'business' | 'controls', BankEntry[]> = {
  daily: [
    { en: "Hey, how's it going?", ja: 'やあ、調子どう？' },
    { en: 'Not bad. Just trying to survive Monday.', ja: 'まあまあ。月曜を乗り切ろうとしてるとこ。' },
    { en: 'What did you get up to this weekend?', ja: '週末は何してた？' },
    { en: 'I ended up just staying home and catching up on sleep.', ja: '結局家で寝だめしてた。' },
    { en: "That sounds nice, honestly. I could use a weekend like that.", ja: '正直それいいな。そういう週末が欲しい。' },
    { en: "Do you want to grab lunch later?", ja: 'あとで昼飯行かない？' },
    { en: "I'm good with whatever. You pick.", ja: '何でもいいよ。任せる。' },
    { en: "Sorry, I didn't catch that. Could you say it again?", ja: 'ごめん、聞き取れなかった。もう一回言って？' },
    { en: "Let me think about that for a second.", ja: 'ちょっと考えさせて。' },
    { en: "That's a good point. I hadn't thought of it that way.", ja: 'いい指摘だね。そう考えたことなかった。' },
    { en: "I've been meaning to try that place.", ja: 'あの店、行こうと思ってたんだ。' },
    { en: "How was your commute? Traffic was brutal this morning.", ja: '通勤どうだった？今朝は渋滞ひどかった。' },
    { en: "I'm a huge soccer fan. I never miss a Barcelona game.", ja: 'サッカー大好きで、バルサの試合は欠かさない。' },
    { en: "Do you play yourself, or do you mostly watch?", ja: '自分でもやる？それとも見る専門？' },
    { en: "We should do this again sometime.", ja: 'またやろうよ。' },
    { en: "No way! Are you serious?", ja: 'うそでしょ！本当に？' },
    { en: "Gotcha. That makes sense.", ja: 'なるほど。納得。' },
    { en: "I'm gonna head out. Have a good one!", ja: 'そろそろ行くね。じゃあまた！' },
    { en: "Long story short, it worked out in the end.", ja: '要するに、最後はうまくいった。' },
    { en: "It's been a crazy week, to be honest.", ja: '正直、今週はめちゃくちゃだった。' },
  ],
  business: [
    { en: "Thanks for jumping on the call. Can everyone hear me okay?", ja: '参加ありがとう。みんな聞こえてる？' },
    { en: "Let me walk you through where we are on the project.", ja: 'プロジェクトの現状を説明します。' },
    { en: "We're on track for the delivery date, but the drives are a risk.", ja: '納期は予定どおりですが、ドライブがリスクです。' },
    { en: "Could you clarify what you mean by that?", ja: 'それはどういう意味か確認できますか？' },
    { en: "Just to confirm, you want this done by the end of next week?", ja: '確認ですが、来週末までに必要ということですね？' },
    { en: "That's going to push the schedule back by about a week.", ja: 'それだとスケジュールが 1 週間ほど後ろにずれます。' },
    { en: "I'll check with the team and get back to you by tomorrow.", ja: 'チームに確認して明日までに返事します。' },
    { en: "Can we treat that as a change order?", ja: 'それは変更依頼として扱えますか？' },
    { en: "What's the lead time on that part?", ja: 'その部品の納期はどのくらい？' },
    { en: "Let's take that offline and keep moving.", ja: 'それは別途話して、先に進めましょう。' },
    { en: "I want to make sure we're on the same page.", ja: '認識を合わせておきたいです。' },
    { en: "Here's what I'd suggest.", ja: '私の提案はこうです。' },
    { en: "Does that work for you?", ja: 'それで問題ないですか？' },
    { en: "We found the root cause. It was a loose terminal.", ja: '原因が分かりました。端子の緩みでした。' },
    { en: "The line was down for about two hours.", ja: 'ラインは 2 時間ほど停止しました。' },
    { en: "We'll need to revise the drawings and send you the redlines.", ja: '図面を改訂して赤入れを送ります。' },
    { en: "I'd like to schedule the FAT for the second week of November.", ja: 'FAT を 11 月第 2 週に設定したいです。' },
    { en: "Can you send me the updated BOM?", ja: '更新した部品表を送ってもらえますか？' },
    { en: "That's out of scope for this phase.", ja: 'それは今回のフェーズの範囲外です。' },
    { en: "Let me summarize the action items.", ja: 'アクションアイテムをまとめます。' },
  ],
  controls: [
    { en: "The E-stop circuit is hardwired and goes through the safety relay.", ja: '非常停止回路はハードワイヤで安全リレーを通しています。' },
    { en: "The interlock on the guard door stops the conveyor when it opens.", ja: 'ガードドアのインターロックで、開くとコンベヤが止まります。' },
    { en: "We've got sixteen digital inputs and eight outputs on that rack.", ja: 'そのラックはデジタル入力 16 点、出力 8 点です。' },
    { en: "The panel is a NEMA 12 enclosure with a 480-volt three-phase feed.", ja: '盤は NEMA 12 の筐体で、480V 三相給電です。' },
    { en: "All the field wiring lands on terminal blocks on the right side.", ja: 'フィールド配線は右側の端子台に落ちます。' },
    { en: "The HMI shows the alarm, but the PLC never sets the bit.", ja: 'タッチパネルにはアラームが出るけど、PLC がビットを立てていない。' },
    { en: "Let's check the ladder logic for that output.", ja: 'その出力のラダーを確認しましょう。' },
    { en: "The VFD is tripping on overcurrent during startup.", ja: '起動時に VFD が過電流でトリップします。' },
    { en: "Make sure the drive is locked out before you open the panel.", ja: '盤を開ける前にドライブをロックアウトしてください。' },
    { en: "We tag out the main disconnect and verify zero energy.", ja: '主電源遮断器にタグアウトし、ゼロエネルギーを確認します。' },
    { en: "The proximity sensor is mounted too far from the target.", ja: '近接センサーの取り付けがターゲットから離れすぎています。' },
    { en: "Swap the photoeye and see if the fault clears.", ja: '光電センサーを交換して故障が消えるか見てみて。' },
    { en: "The servo drive lost its encoder feedback.", ja: 'サーボドライブがエンコーダのフィードバックを失いました。' },
    { en: "Cycle time is about twelve seconds per part.", ja: 'サイクルタイムは 1 個あたり約 12 秒です。' },
    { en: "We'll do commissioning on site after the FAT.", ja: 'FAT のあと現地で立ち上げを行います。' },
    { en: "That revision isn't reflected in the as-built drawings yet.", ja: 'その改訂はまだ竣工図に反映されていません。' },
    { en: "The customer uses Allen-Bradley, so we're on ControlLogix.", ja: '客先はアレン・ブラッドリーなので ControlLogix を使います。' },
    { en: "Can you export the I/O list to a spreadsheet?", ja: 'I/O リストをスプレッドシートに出せますか？' },
    { en: "The 24-volt supply is sagging under load.", ja: '24V 電源が負荷時に電圧降下しています。' },
    { en: "We need a spare contactor on the shelf for that motor.", ja: 'そのモーター用の予備コンタクタを棚に置いておく必要があります。' },
  ],
};

export function bankItems(category: keyof typeof BANK): NewShadowItem[] {
  return BANK[category].map((e) => ({ text: e.en, source: 'bank', jaText: e.ja }));
}
