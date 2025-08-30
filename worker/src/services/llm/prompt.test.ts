import { describe, it, expect } from 'vitest';
import { buildLLMSystemPrompt } from './prompt';

describe('services/llm/prompt.buildLLMSystemPrompt', () => {
  it('injects reasoning level', () => {
    const low = buildLLMSystemPrompt({ reasoning: 'low' });
    const high = buildLLMSystemPrompt({ reasoning: 'high' });
    expect(low).toContain('Reasoning: low');
    expect(high).toContain('Reasoning: high');
  });

  it('injects current date when provided', () => {
    const p = buildLLMSystemPrompt({ reasoning: 'medium', currentDate: '2025-01-02' });
    expect(p).toContain('Current date: 2025-01-02');
  });
});
