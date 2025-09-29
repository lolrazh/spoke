import { describe, it, expect } from 'vitest';
import { buildSTTPrompt, DEFAULT_STT_PROMPT } from './prompt';

describe('services/stt/prompt', () => {
  it('returns base prompt by default', () => {
    expect(buildSTTPrompt()).toBe(DEFAULT_STT_PROMPT);
  });

  it('appends extra vocab when provided', () => {
    const p = buildSTTPrompt({ extraVocab: ['Sonic Flow', 'Groq'] });
    expect(p).toBe('Your vocabulary includes: Sonic Flow, Groq');
  });

  it('appends identity tokens when available', () => {
    const p = buildSTTPrompt({ identity: { name: 'Taylor Swift', email: 'taylor@example.com' } });
    expect(p).toBe('Your vocabulary includes: Sonic Flow, Taylor Swift, taylor@example.com');
  });

  it('dedupes tokens already present in base prompt', () => {
    const p = buildSTTPrompt({ basePrompt: 'Your vocabulary includes: Sonic Flow', identity: { name: 'Sonic Flow' } });
    expect(p).toBe('Your vocabulary includes: Sonic Flow');
  });
});

