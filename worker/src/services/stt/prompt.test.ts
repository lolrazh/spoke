import { describe, it, expect } from 'vitest';
import { buildSTTPrompt, DEFAULT_STT_PROMPT } from './prompt';

describe('services/stt/prompt', () => {
  it('returns base prompt by default', () => {
    expect(buildSTTPrompt()).toBe(DEFAULT_STT_PROMPT);
  });

  it('appends extra vocab when provided', () => {
    const p = buildSTTPrompt({ extraVocab: ['Sonic Flow', 'Groq'] });
    expect(p).toContain('plus: Sonic Flow, Groq');
  });
});

