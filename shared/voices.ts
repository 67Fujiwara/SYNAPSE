/** Deepgram Aura 2 (English) speakers on Workers AI, with rough descriptions for the picker. */
export interface VoiceInfo {
  id: string;
  gender: 'f' | 'm';
  accent: 'US' | 'UK' | 'AU';
  note: string;
}

export const AURA_VOICES: VoiceInfo[] = [
  { id: 'thalia', gender: 'f', accent: 'US', note: 'clear, confident, energetic' },
  { id: 'asteria', gender: 'f', accent: 'US', note: 'clear, knowledgeable' },
  { id: 'luna', gender: 'f', accent: 'US', note: 'friendly, natural' },
  { id: 'athena', gender: 'f', accent: 'US', note: 'calm, smooth' },
  { id: 'hera', gender: 'f', accent: 'US', note: 'smooth, warm' },
  { id: 'andromeda', gender: 'f', accent: 'US', note: 'casual, expressive' },
  { id: 'aurora', gender: 'f', accent: 'US', note: 'cheerful, expressive' },
  { id: 'callista', gender: 'f', accent: 'US', note: 'clear, energetic' },
  { id: 'cora', gender: 'f', accent: 'US', note: 'smooth, melodic' },
  { id: 'cordelia', gender: 'f', accent: 'US', note: 'approachable, warm' },
  { id: 'delia', gender: 'f', accent: 'US', note: 'casual, friendly' },
  { id: 'electra', gender: 'f', accent: 'US', note: 'professional, engaging' },
  { id: 'harmonia', gender: 'f', accent: 'US', note: 'empathetic, clear' },
  { id: 'helena', gender: 'f', accent: 'US', note: 'caring, natural' },
  { id: 'iris', gender: 'f', accent: 'US', note: 'cheerful, positive' },
  { id: 'janus', gender: 'f', accent: 'US', note: 'southern, smooth' },
  { id: 'juno', gender: 'f', accent: 'US', note: 'natural, engaging' },
  { id: 'minerva', gender: 'f', accent: 'US', note: 'positive, friendly' },
  { id: 'ophelia', gender: 'f', accent: 'US', note: 'expressive, enthusiastic' },
  { id: 'phoebe', gender: 'f', accent: 'US', note: 'energetic, warm' },
  { id: 'vesta', gender: 'f', accent: 'US', note: 'natural, expressive' },
  { id: 'amalthea', gender: 'f', accent: 'US', note: 'engaging, natural' },
  { id: 'pandora', gender: 'f', accent: 'UK', note: 'smooth, calm' },
  { id: 'theia', gender: 'f', accent: 'AU', note: 'expressive, polite' },
  { id: 'orion', gender: 'm', accent: 'US', note: 'approachable, comfortable' },
  { id: 'arcas', gender: 'm', accent: 'US', note: 'natural, smooth' },
  { id: 'apollo', gender: 'm', accent: 'US', note: 'confident, casual' },
  { id: 'aries', gender: 'm', accent: 'US', note: 'warm, energetic' },
  { id: 'atlas', gender: 'm', accent: 'US', note: 'enthusiastic, confident' },
  { id: 'hermes', gender: 'm', accent: 'US', note: 'expressive, engaging' },
  { id: 'jupiter', gender: 'm', accent: 'US', note: 'expressive, knowledgeable' },
  { id: 'mars', gender: 'm', accent: 'US', note: 'smooth, patient' },
  { id: 'neptune', gender: 'm', accent: 'US', note: 'professional, patient' },
  { id: 'odysseus', gender: 'm', accent: 'US', note: 'calm, smooth' },
  { id: 'orpheus', gender: 'm', accent: 'US', note: 'professional, clear' },
  { id: 'pluto', gender: 'm', accent: 'US', note: 'smooth, calm' },
  { id: 'saturn', gender: 'm', accent: 'US', note: 'knowledgeable, confident' },
  { id: 'zeus', gender: 'm', accent: 'US', note: 'deep, trustworthy' },
  { id: 'draco', gender: 'm', accent: 'UK', note: 'warm, approachable' },
  { id: 'hyperion', gender: 'm', accent: 'AU', note: 'caring, warm' },
];

export const AURA_VOICE_IDS = new Set(AURA_VOICES.map((v) => v.id));
