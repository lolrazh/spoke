import { describe, it, expect, vi } from 'vitest';

vi.mock('./groq', () => ({
  chatComplete: vi.fn(async (opts: any) => ({ text: 'groq', timings: { startAt: 1, headersAt: 2, bodyDoneAt: 3 } }))
}));

vi.mock('./openai', () => ({
  chatComplete: vi.fn(async (opts: any) => ({ text: 'openai', timings: { startAt: 1, headersAt: 2, bodyDoneAt: 3 } }))
}));

import { chatCompleteByProvider } from './index';
import { chatComplete as groqImpl } from './groq';
import { chatComplete as openaiImpl } from './openai';

describe('services/llm/index.chatCompleteByProvider', () => {
  it('dispatches to OpenAI when provider=openai', async () => {
    const res = await chatCompleteByProvider('openai', { apiKey: 'k', userContent: 'hi' });
    expect(res.text).toBe('openai');
    expect(openaiImpl).toHaveBeenCalledTimes(1);
    expect(groqImpl).not.toHaveBeenCalled();
  });

  it('dispatches to Groq when provider=groq', async () => {
    const res = await chatCompleteByProvider('groq', { apiKey: 'k', userContent: 'hi' });
    expect(res.text).toBe('groq');
    expect(groqImpl).toHaveBeenCalledTimes(1);
  });
});


