import { describe, it, expect } from 'vitest';
import { buildLLMSystemPrompt } from './prompt';

describe('services/llm/prompt', () => {
  it('inserts STT vocabulary line when sttPrompt provided', () => {
    const stt = 'Your vocabulary includes: Foo, Bar, Baz';
    const s = buildLLMSystemPrompt({ sttPrompt: stt });
    expect(s).toContain(stt);
  });

  it('omits vocab line when no sttPrompt provided', () => {
    const s = buildLLMSystemPrompt();
    expect(s.includes('Your vocabulary includes')).toBe(false);
  });
});

