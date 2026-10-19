import { describe, expect, it } from 'vitest';
import { looksHallucinated, lowConfidence } from './hallucination';

describe('looksHallucinated', () => {
  it('catches subtitle boilerplate and repeated phrases', () => {
    expect(looksHallucinated('Capture by GetTranscribed.com Capture by GetTranscribed.com')).toBe(true);
    expect(looksHallucinated('Thanks for watching!')).toBe(true);
    expect(looksHallucinated('Subtitles by the Amara.org community')).toBe(true);
    expect(looksHallucinated('you')).toBe(true);
    expect(looksHallucinated('...')).toBe(true);
    expect(looksHallucinated('I like it I like it I like it I like it')).toBe(true);
  });
  it('keeps real speech', () => {
    expect(looksHallucinated("I'm gonna send them an email tomorrow.")).toBe(false);
    expect(looksHallucinated('The interlock tripped during commissioning')).toBe(false);
    expect(looksHallucinated('Yeah yeah, I think so')).toBe(false);
  });
});

describe('lowConfidence', () => {
  it('flags high no-speech probability or very low logprob', () => {
    expect(lowConfidence([{ no_speech_prob: 0.9, avg_logprob: -0.3 }])).toBe(true);
    expect(lowConfidence([{ no_speech_prob: 0.1, avg_logprob: -1.5 }])).toBe(true);
    expect(lowConfidence([{ no_speech_prob: 0.1, avg_logprob: -0.4 }])).toBe(false);
    expect(lowConfidence(undefined)).toBe(false);
  });
});
