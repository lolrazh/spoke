import { describe, it, expect } from 'vitest';
import { buildLLMSystemPrompt } from './prompt';

describe('services/llm/prompt.buildLLMSystemPrompt', () => {
  it('injects reasoning level', () => {
    const low = buildLLMSystemPrompt({ reasoning: 'low' });
    const high = buildLLMSystemPrompt({ reasoning: 'high' });
    expect(low).toContain('Reasoning: low');
    expect(high).toContain('Reasoning: high');
  });
});

