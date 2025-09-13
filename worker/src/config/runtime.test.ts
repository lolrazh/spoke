import { describe, it, expect } from 'vitest';
import { getRuntimeConfig } from './runtime';

describe('config/runtime.getRuntimeConfig', () => {
  it('returns sane defaults when env is empty', () => {
    const cfg = getRuntimeConfig({});
    expect(cfg.llm.enabled).toBe(true);
    expect(cfg.llm.stream).toBe(true);
    expect(typeof cfg.llm.model).toBe('string');
    expect(['groq','openai','baseten']).toContain(cfg.llm.provider);
    expect(typeof cfg.stt.model).toBe('string');
    expect(typeof cfg.stt.language).toBe('string');
  });

  it('coerces booleans (reasoning removed)', () => {
    const cfg = getRuntimeConfig({ ENABLE_LLM: '0', LLM_STREAM: 'false' });
    expect(cfg.llm.enabled).toBe(false);
    expect(cfg.llm.stream).toBe(false);
  });

  it('applies STT overrides', () => {
    const cfg = getRuntimeConfig({ STT_MODEL: 'whisper-x', STT_LANGUAGE: 'fr', STT_PROMPT: 'hello' });
    expect(cfg.stt.model).toBe('whisper-x');
    expect(cfg.stt.language).toBe('fr');
    expect(cfg.stt.prompt).toBe('hello');
  });

  it('parses LLM provider from env (LLM_PROVIDER preferred)', () => {
    const cfg1 = getRuntimeConfig({ LLM_PROVIDER: 'openai' });
    expect(cfg1.llm.provider).toBe('openai');
    const cfg2 = getRuntimeConfig({ LLM_DEFAULT_PROVIDER: 'groq' });
    expect(cfg2.llm.provider).toBe('groq');
    const cfg3 = getRuntimeConfig({ LLM_PROVIDER: 'baseten' });
    expect(cfg3.llm.provider).toBe('baseten');
    const cfg4 = getRuntimeConfig({ LLM_PROVIDER: 'invalid', LLM_DEFAULT_PROVIDER: 'openai' });
    expect(cfg4.llm.provider).toBe('openai');
  });
});
