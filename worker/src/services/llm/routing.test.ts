import { describe, it, expect } from 'vitest';
import { selectLLMRoute, DEFAULT_LLM_ROUTING_RULES } from './routing';

const baseRuntime = {
  enabled: true,
  stream: true,
  model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
  temperature: 0.2,
  timeoutMs: 25_000,
  currentDate: '2024-09-30',
  provider: 'groq' as const,
  routerEnabled: true,
};

describe('services/llm/routing.selectLLMRoute', () => {
  it('returns runtime defaults when no rule matches', () => {
    const decision = selectLLMRoute('hello world', baseRuntime);
    expect(decision.provider).toBe(baseRuntime.provider);
    expect(decision.model).toBe(baseRuntime.model);
    expect(decision.matchedRuleIds).toEqual([]);
  });

  it('routes spelled sequences to Kimi', () => {
    const decision = selectLLMRoute('Please write D N A sequence', baseRuntime);
    expect(decision.model).toBe('moonshotai/kimi-k2-instruct-0905');
    expect(decision.provider).toBe('groq');
    expect(decision.matchedRuleIds).toContain('spelled-sequence');
  });

  it('matches explicit spell instructions case-insensitively', () => {
    const decision = selectLLMRoute('Can you SPELL it letter by letter?', baseRuntime);
    expect(decision.matchedRuleIds).toContain('spell-instruction');
    expect(decision.model).toBe('moonshotai/kimi-k2-instruct-0905');
  });

  it('routes "can you" phrasing to Kimi', () => {
    const decision = selectLLMRoute('can you format this exactly?', baseRuntime);
    expect(decision.matchedRuleIds).toContain('can-you-instruction');
    expect(decision.model).toBe('moonshotai/kimi-k2-instruct-0905');
  });

  it('returns all matched rule ids in order using defaults', () => {
    const text = 'Make this uppercase A B C';
    const decision = selectLLMRoute(text, baseRuntime);
    expect(decision.matchedRuleIds).toEqual(['spelled-sequence', 'formatting-instruction']);
  });

  it('detects additional formatting keywords', () => {
    const decision = selectLLMRoute('Please emphasize the word and use caps', baseRuntime);
    expect(decision.matchedRuleIds).toContain('formatting-instruction');
    expect(decision.model).toBe('moonshotai/kimi-k2-instruct-0905');
  });

  it('allows custom rule overrides', () => {
    const customRules = [
      { id: 'custom', pattern: /override/i, provider: 'openrouter' as const, model: 'custom-model' },
      ...DEFAULT_LLM_ROUTING_RULES,
    ];
    const decision = selectLLMRoute('override this please', baseRuntime, customRules);
    expect(decision.provider).toBe('openrouter');
    expect(decision.model).toBe('custom-model');
    expect(decision.matchedRuleIds).toEqual(['custom']);
  });

  it('routes long transcripts to Kimi even without regex matches', () => {
    const longText = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const decision = selectLLMRoute(longText, baseRuntime);
    expect(decision.provider).toBe('groq');
    expect(decision.model).toBe('moonshotai/kimi-k2-instruct-0905');
    expect(decision.matchedRuleIds[0]).toBe('length-threshold');
  });

  it('does not trigger length rule for shorter transcripts', () => {
    const shorterText = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ');
    const decision = selectLLMRoute(shorterText, baseRuntime);
    expect(decision.provider).toBe(baseRuntime.provider);
    expect(decision.model).toBe(baseRuntime.model);
    expect(decision.matchedRuleIds).toEqual([]);
  });

  it('bypasses routing when router is disabled', () => {
    const disabledRuntime = { ...baseRuntime, routerEnabled: false };
    
    // Test with spelled sequence (would normally route to Kimi)
    const decision1 = selectLLMRoute('Please write D N A sequence', disabledRuntime);
    expect(decision1.provider).toBe(disabledRuntime.provider);
    expect(decision1.model).toBe(disabledRuntime.model);
    expect(decision1.matchedRuleIds).toEqual([]);
    
    // Test with "can you" instruction (would normally route to Kimi)
    const decision2 = selectLLMRoute('can you format this exactly?', disabledRuntime);
    expect(decision2.provider).toBe(disabledRuntime.provider);
    expect(decision2.model).toBe(disabledRuntime.model);
    expect(decision2.matchedRuleIds).toEqual([]);
    
    // Test with long text (would normally route to Kimi)
    const longText = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const decision3 = selectLLMRoute(longText, disabledRuntime);
    expect(decision3.provider).toBe(disabledRuntime.provider);
    expect(decision3.model).toBe(disabledRuntime.model);
    expect(decision3.matchedRuleIds).toEqual([]);
  });
});
