import type { Synthesizer } from './types';
import { WebSpeechSynthesizer } from './synthesis';
import { ServerSynthesizer } from './server-synthesizer';
import type { TtsEngine } from '@shared/types';

export function makeSynthesizer(engine: TtsEngine, serverVoice: string): Synthesizer {
  return engine === 'server' ? new ServerSynthesizer(serverVoice) : new WebSpeechSynthesizer();
}
