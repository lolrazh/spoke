import { describe, it, expect } from 'vitest';
import { buildLLMSystemPrompt } from './prompt';

describe('services/llm/prompt', () => {
  it('inserts STT vocabulary line above current date', () => {
    const stt = 'Your vocabulary includes: Foo, Bar, Baz';
    const date = '2024-01-02';
    const s = buildLLMSystemPrompt({ currentDate: date, sttPrompt: stt });
    expect(s).toContain(stt);
    expect(s).toContain(`Current date: ${date}`);
    expect(s.indexOf(stt)).toBeLessThan(s.indexOf(`Current date: ${date}`));
  });

  it('omits vocab line when no sttPrompt provided', () => {
    const date = '2024-05-10';
    const s = buildLLMSystemPrompt({ currentDate: date });
    expect(s).toContain(`Current date: ${date}`);
    expect(s.includes('Your vocabulary includes')).toBe(false);
  });
});

