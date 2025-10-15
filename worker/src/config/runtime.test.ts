import { describe, it, expect } from 'vitest';
import { getRuntimeConfig } from './runtime';
import { DEEPGRAM_STT_DEFAULT_MODEL } from '../config';

describe('config/runtime.getRuntimeConfig', () => {
  it('returns sane defaults when env is empty', () => {
    const cfg = getRuntimeConfig({});
    expect(cfg.llm.enabled).toBe(true);
    expect(cfg.llm.stream).toBe(true);
    expect(typeof cfg.llm.model).toBe('string');
    expect(['groq','openai','baseten','openrouter']).toContain(cfg.llm.provider);
    expect(typeof cfg.stt.model).toBe('string');
    expect(typeof cfg.stt.language).toBe('string');
    expect(['groq','fireworks','deepgram']).toContain(cfg.stt.provider);
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

  it('parses STT provider override', () => {
    const cfg = getRuntimeConfig({ STT_PROVIDER: 'fireworks' });
    expect(cfg.stt.provider).toBe('fireworks');
    const deepgram = getRuntimeConfig({ STT_PROVIDER: 'deepgram' });
    expect(deepgram.stt.provider).toBe('deepgram');
    expect(deepgram.stt.model).toBe(DEEPGRAM_STT_DEFAULT_MODEL);
    const fallback = getRuntimeConfig({ STT_PROVIDER: 'invalid' });
    expect(['groq','fireworks','deepgram']).toContain(fallback.stt.provider);
  });

  it('parses LLM provider from env (LLM_PROVIDER preferred)', () => {
    const cfg1 = getRuntimeConfig({ LLM_PROVIDER: 'openai' });
    expect(cfg1.llm.provider).toBe('openai');
    const cfg2 = getRuntimeConfig({ LLM_DEFAULT_PROVIDER: 'groq' });
    expect(cfg2.llm.provider).toBe('groq');
    const cfg3 = getRuntimeConfig({ LLM_PROVIDER: 'baseten' });
    expect(cfg3.llm.provider).toBe('baseten');
    const cfg4 = getRuntimeConfig({ LLM_PROVIDER: 'openrouter' });
    expect(cfg4.llm.provider).toBe('openrouter');
    const cfg5 = getRuntimeConfig({ LLM_PROVIDER: 'invalid', LLM_DEFAULT_PROVIDER: 'openai' });
    expect(cfg5.llm.provider).toBe('openai');
  });

  it('uses provider-specific default models when none supplied', () => {
    const cfg = getRuntimeConfig({ LLM_PROVIDER: 'openrouter' });
    expect(cfg.llm.model).toBe('qwen/qwen3-235b-a22b-2507');
    const editCfg = getRuntimeConfig({ EDIT_LLM_PROVIDER: 'openrouter' });
    expect(editCfg.edit.model).toBe('qwen/qwen3-235b-a22b-2507');
  });
});
