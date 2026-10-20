// Starter drills for 瞬間英作文, one set per level, so the mode works before any AI generation.
// Keep answers short and spoken; the generator (/api/instant/generate) adds personalized sets.
import type { NewInstantItem } from '@shared/types';
import type { InstantLevel } from '@shared/instant';

type Seed = Omit<NewInstantItem, 'level' | 'cueKind' | 'source'>;

const L1: Seed[] = [
  { cue: '私は朝が弱いです。', answer: "I'm not a morning person.", alternatives: ['I am not a morning person.'], hint: '「〜が苦手」は not a 〜 person でも言える', topic: 'daily' },
  { cue: '今日は会議が 2 つあります。', answer: 'I have two meetings today.', alternatives: ["I've got two meetings today."], hint: '予定は have で言う', topic: 'work' },
  { cue: '昨日は遅くまで働きました。', answer: 'I worked late yesterday.', alternatives: ['I worked until late yesterday.'], hint: '過去形 worked', topic: 'work' },
  { cue: 'あの店に行ったことがありますか？', answer: 'Have you been to that place?', alternatives: ['Have you ever been to that place?'], hint: '経験は Have you been to 〜?', topic: 'daily' },
  { cue: 'コーヒーをもう一杯もらえますか？', answer: 'Can I get another coffee?', alternatives: ['Could I have another coffee?'], hint: '頼むときは Can I get 〜?', topic: 'daily' },
  { cue: '彼は今、席にいません。', answer: "He's not at his desk right now.", alternatives: ['He is not at his desk right now.'], hint: '場所の否定は be 動詞 + not', topic: 'work' },
  { cue: 'それは私の仕事ではありません。', answer: "That's not my job.", alternatives: ['That is not my job.'], hint: 'That is → That\'s', topic: 'work' },
  { cue: '週末は何をしましたか？', answer: 'What did you do this weekend?', alternatives: ['What did you get up to this weekend?'], hint: '疑問文は did + 動詞の原形', topic: 'daily' },
  { cue: '机の上に図面があります。', answer: 'There is a drawing on the desk.', alternatives: ["There's a drawing on the desk."], hint: '「〜がある」は There is', topic: 'work' },
  { cue: '私は 5 時に帰らないといけません。', answer: 'I have to leave at five.', alternatives: ['I need to leave at five.'], hint: '義務は have to', topic: 'daily' },
];

const L2: Seed[] = [
  { cue: 'I checked the wiring this morning.', transform: '疑問文に', answer: 'Did you check the wiring this morning?', alternatives: [], hint: '過去の疑問文は Did you + 原形', topic: 'work' },
  { cue: 'The panel is ready.', transform: '否定文に', answer: "The panel isn't ready.", alternatives: ['The panel is not ready.'], hint: 'be 動詞 + not', topic: 'work' },
  { cue: 'We test the machine on Friday.', transform: '未来形に', answer: "We're going to test the machine on Friday.", alternatives: ["We'll test the machine on Friday.", 'We will test the machine on Friday.'], hint: '予定は be going to', topic: 'work' },
  { cue: 'I send the report.', transform: '現在完了に（もう送った）', answer: "I've already sent the report.", alternatives: ['I have already sent the report.'], hint: 'have + 過去分詞 sent', topic: 'work' },
  { cue: 'You call the vendor.', transform: 'should を使って', answer: 'You should call the vendor.', alternatives: [], hint: '助動詞 + 原形', topic: 'vendor' },
  { cue: 'Someone changed the drawing.', transform: '受け身に', answer: 'The drawing was changed.', alternatives: ['The drawing has been changed.'], hint: 'be + 過去分詞', topic: 'work' },
  { cue: 'Where is the terminal block?', transform: '丁寧に聞く（Do you know 〜）', answer: 'Do you know where the terminal block is?', alternatives: [], hint: '間接疑問は語順が平叙文に戻る', topic: 'work' },
  { cue: 'The alarm goes off. We stop the line.', transform: 'if 文に', answer: 'If the alarm goes off, we stop the line.', alternatives: ['We stop the line if the alarm goes off.'], hint: 'if 節は現在形', topic: 'safety' },
  { cue: 'Open the door.', transform: '丁寧な依頼に', answer: 'Could you open the door?', alternatives: ['Could you open the door, please?', 'Would you mind opening the door?'], hint: 'Could you 〜?', topic: 'daily' },
  { cue: 'He fixes it today.', transform: '「できない」に', answer: "He can't fix it today.", alternatives: ['He cannot fix it today.'], hint: "can't + 原形", topic: 'work' },
];

const L3: Seed[] = [
  { cue: 'ベンダーが納期を 2 週間延ばしたいと言っています。', answer: 'The vendor wants to push the delivery back two weeks.', alternatives: ['The vendor is asking to delay delivery by two weeks.'], hint: '延ばす = push back', topic: 'vendor' },
  { cue: '先週私が送った図面の最新版はどれですか？', answer: 'Which one is the latest version of the drawing I sent last week?', alternatives: ['Which is the latest revision of the drawing I sent last week?'], hint: '関係代名詞は省略できる (the drawing I sent)', topic: 'work' },
  { cue: 'もし非常停止が押されたら、全ての出力が落ちます。', answer: 'If the E-stop is pressed, all the outputs drop out.', alternatives: ['When the E-stop is pressed, every output drops out.'], hint: '落ちる = drop out', topic: 'safety' },
  { cue: 'この端子台は古いものより熱に強いです。', answer: 'This terminal block handles heat better than the old one.', alternatives: ['This terminal block is more heat-resistant than the old one.'], hint: '比較は 〜 than the old one', topic: 'work' },
  { cue: '原因が分かるまで、その機械は動かさないでください。', answer: "Please don't run that machine until we know the root cause.", alternatives: ["Don't run that machine until we find the root cause."], hint: '〜するまで = until', topic: 'troubleshooting' },
  { cue: 'PLC のプログラムをアップロードする前にバックアップを取りました。', answer: 'I backed up the PLC program before uploading it.', alternatives: ['I made a backup of the PLC program before I uploaded it.'], hint: 'before + 動詞 ing', topic: 'work' },
  { cue: '客先は来月の立ち上げに間に合うか心配しています。', answer: "The customer is worried we won't make the start-up next month.", alternatives: ["The customer is concerned about whether we'll be ready for commissioning next month."], hint: '間に合う = make it', topic: 'meeting' },
  { cue: 'センサーの配線を入れ替えたら、アラームが消えました。', answer: 'After I swapped the sensor wiring, the alarm went away.', alternatives: ['Once I swapped the sensor wires, the alarm cleared.'], hint: '入れ替える = swap', topic: 'troubleshooting' },
  { cue: 'インターロックが効いているか、もう一度確認してもらえますか？', answer: 'Could you double-check that the interlock is working?', alternatives: ['Can you check again whether the interlock is working?'], hint: 'double-check', topic: 'safety' },
  { cue: 'その部品は在庫切れなので、代替品を探しています。', answer: "That part is out of stock, so we're looking for an alternative.", alternatives: ["That part is out of stock, so I'm looking for a substitute."], hint: '在庫切れ = out of stock', topic: 'vendor' },
];

const L4: Seed[] = [
  { cue: 'ベンダーに、納期を 1 週間早められるか聞く。', answer: 'Could you move the delivery up by a week?', alternatives: ['Is there any way to deliver a week earlier?', 'Can we get it one week sooner?'], keywords: ['could you', 'a week'], hint: '前倒し = move up / earlier', topic: 'vendor' },
  { cue: '同僚に、今日は残業できないと伝える。', answer: "I can't stay late today, sorry.", alternatives: ["I'm not able to work overtime today.", "I have to leave on time today."], keywords: ["can't", 'today'], hint: '残業する = stay late', topic: 'work' },
  { cue: '会議で、相手の説明が速すぎたのでもう一度頼む。', answer: 'Sorry, could you go over that again a bit more slowly?', alternatives: ['Could you repeat that more slowly?', "I didn't catch that. Could you say it again?"], keywords: ['could you', 'again'], hint: 'go over = 説明する', topic: 'meeting' },
  { cue: '上司に、ラインが止まった原因はセンサーの故障だったと報告する。', answer: 'The line stopped because a sensor failed.', alternatives: ['The root cause of the stop was a failed sensor.', 'A bad sensor caused the line to stop.'], keywords: ['sensor', 'stopped'], hint: '〜のせいで = because', topic: 'troubleshooting' },
  { cue: '初対面の人に、自分の仕事を一言で説明する。', answer: 'I design control panels for factory equipment.', alternatives: ['I do electrical and controls design for machines.', "I'm a controls engineer. I design the electrical side of machines."], keywords: ['design', 'control'], hint: '〜を設計する = design', topic: 'daily' },
  { cue: '客先に、図面の変更を金曜までに送ると約束する。', answer: "I'll send you the revised drawings by Friday.", alternatives: ["You'll have the updated drawings by Friday.", "I'll get the drawing changes to you by Friday."], keywords: ['by friday', 'drawing'], hint: '期限は by', topic: 'work' },
  { cue: 'ランチに誘われたが、今日は忙しいので断る。', answer: "I'd love to, but I'm swamped today.", alternatives: ["Sorry, I can't today. I'm slammed.", 'Not today, sorry. I have too much on my plate.'], keywords: ['today'], hint: '忙しい = swamped / slammed', topic: 'daily' },
  { cue: '作業者に、電源を切るまで盤を開けないよう注意する。', answer: "Don't open the panel until the power is off.", alternatives: ['Make sure the power is off before you open the panel.', 'Lock out the power before opening the panel.'], keywords: ['power', 'panel'], hint: '〜まで = until', topic: 'safety' },
];

const L5: Seed[] = [
  { cue: 'FAT の日程を 1 週間ずらしてほしいと客先に頼み、理由（部品の遅れ）も言う。', answer: "Could we push the FAT back one week? One of the drive units is arriving late.", alternatives: ["We'd like to move the FAT a week later because a drive is delayed.", "Is it possible to delay the FAT by a week? A key part is running late."], keywords: ['fat', 'week', 'late'], hint: 'お願い + 理由を 2 文で', topic: 'meeting' },
  { cue: 'ベンダーの提案（安いリレー）を断り、代わりに今の型番を続けたい理由を言う。', answer: "I'd rather stay with the current relay. We've never had a failure with it, and the spares are already on site.", alternatives: ["Thanks, but let's keep the current part. It's proven, and we already stock spares."], keywords: ['current', 'spares'], hint: '断る + 根拠 (proven, spares)', topic: 'vendor' },
  { cue: '不具合の報告: HMI が固まったこと、原因、対策を短く言う。', answer: 'The HMI froze twice this morning. It turned out to be a memory leak in a screen script, so we rewrote it and it has been stable since.', alternatives: ['The HMI locked up twice. The cause was a screen script leaking memory. We fixed the script and it has run fine since then.'], keywords: ['hmi', 'since'], hint: '事象 → 原因 → 対策', topic: 'troubleshooting' },
  { cue: '同僚の案に反対し、代替案を出す（配線を変えるのではなく設定を変える）。', answer: "I don't think rewiring is the way to go. We could change the parameter instead, and that way we don't touch the panel.", alternatives: ["Rather than rewiring, let's change the setting. That saves us opening the panel."], keywords: ['instead', 'panel'], hint: '反対 + instead で代案', topic: 'meeting' },
  { cue: '週末の予定を聞かれて、予定と理由を言う。', answer: "I'm taking my kids to Osaka this weekend. They've been asking to see the aquarium for months.", alternatives: ["We're heading to Osaka for the weekend because the kids want to see the aquarium."], keywords: ['weekend'], hint: '予定 + because / 補足', topic: 'daily' },
  { cue: '新しい作業者に、ロックアウトが必要な理由を説明する。', answer: 'You have to lock out the power before you work inside. Otherwise someone could start the machine while your hands are in it.', alternatives: ['Always lock out the main power first. If you don\'t, the machine could start while you\'re inside the panel.'], keywords: ['lock out', 'otherwise'], hint: 'ルール + otherwise で起きること', topic: 'safety' },
];

const SETS: Record<InstantLevel, Seed[]> = { 1: L1, 2: L2, 3: L3, 4: L4, 5: L5 };

export function starterItems(level: InstantLevel): NewInstantItem[] {
  const kind = level === 2 ? 'transform' : level >= 4 ? 'situation' : 'sentence';
  return SETS[level].map((s) => ({ level, cueKind: kind, source: 'bank', alternatives: [], keywords: [], ...s }));
}
