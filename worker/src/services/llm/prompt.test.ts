import { describe, it, expect } from 'vitest';
import { buildLLMSystemPrompt } from './prompt';

describe('services/llm/prompt.buildLLMSystemPrompt', () => {
  it('injects current date when provided', () => {
    const p = buildLLMSystemPrompt({ currentDate: '2025-01-02' });
    expect(p).toContain('Current date: 2025-01-02');
    expect(p).not.toContain('Reasoning:');
  });
});
