// Contractions are the same answer in instant composition ("I'm not" == "I am not"),
// unlike shadowing where the exact rhythm is the point. Expand both sides before aligning.

const FIXED: Record<string, string> = {
  "can't": 'can not',
  cannot: 'can not',
  "won't": 'will not',
  "shan't": 'shall not',
  "ain't": 'is not',
  "let's": 'let us',
  "i'm": 'i am',
  "y'all": 'you all',
  gonna: 'going to',
  wanna: 'want to',
  gotta: 'got to',
};

const SUFFIX: [RegExp, string][] = [
  [/n't\b/g, ' not'],
  [/'re\b/g, ' are'],
  [/'ve\b/g, ' have'],
  [/'ll\b/g, ' will'],
  [/'d\b/g, ' would'],
  [/'m\b/g, ' am'],
  // 's is "is" for pronouns / question words / this-that-there; possessives are left alone.
  [/\b(he|she|it|that|this|there|here|what|where|who|how|when|why)'s\b/g, '$1 is'],
];

export function expandContractions(text: string): string {
  let t = text.toLowerCase().replace(/[’‘]/g, "'");
  t = t.replace(/\b[a-z']+\b/g, (w) => FIXED[w] ?? w);
  for (const [re, rep] of SUFFIX) t = t.replace(re, rep);
  return t;
}
