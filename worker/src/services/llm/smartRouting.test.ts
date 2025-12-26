import { describe, it, expect } from 'vitest';
import { selectSmartRoute, selectEditRoute } from './smartRouting';
import { detectTriggers } from './triggers';
import type { RuntimeConfig } from '../../config/runtime';

const baseRuntime: RuntimeConfig = {
  llm: {
    enabled: true,
    stream: true,
    model: 'llama-3.3-70b-versatile',
    temperature: 0.2,
    timeoutMs: 25_000,
    currentDate: '2024-12-25',
    provider: 'cerebras',
    routerEnabled: true,
  },
  stt: {
    provider: 'simplismart',
    model: 'whisper-large-v3-turbo',
    language: 'en',
    timeoutMs: 25_000,
  },
  advanced: {
    enabled: true,
    stream: true,
    model: 'kimi-k2-instruct',
    temperature: 0.3,
    timeoutMs: 30_000,
    provider: 'cerebras',
  },
  edit: {
    enabled: true,
    stream: true,
    model: 'kimi-k2-instruct',
    temperature: 0.6,
    timeoutMs: 30_000,
    provider: 'cerebras',
  },
};

describe('services/llm/smartRouting', () => {
  describe('selectSmartRoute - bypass tier', () => {
    it('bypasses LLM for clean dictation with no triggers', () => {
      const text = 'This is a normal sentence with no special instructions';
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseRuntime);

      expect(decision.tier).toBe('bypass');
      expect(decision.provider).toBeUndefined();
      expect(decision.model).toBeUndefined();
      expect(decision.triggeredRules).toEqual([]);
      expect(decision.reason).toBe('no_triggers_detected');
    });

    it('bypasses for multiple clean sentences', () => {
      const text = 'The quick brown fox jumps over the lazy dog. This is a test.';
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseRuntime);

      expect(decision.tier).toBe('bypass');
    });
  });

  describe('selectSmartRoute - default tier', () => {
    it('routes to default model for spelling triggers', () => {
      const text = 'Please spell that as S-P-O-K-E';
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseRuntime);

      expect(decision.tier).toBe('default');
      expect(decision.provider).toBe('cerebras');
      expect(decision.model).toBe('llama-3.3-70b-versatile');
      expect(decision.temperature).toBe(0.2);
      expect(decision.triggeredRules).toContain('spelling');
      expect(decision.reason).toContain('triggers_detected');
    });

    it('routes to default model for symbol triggers', () => {
      const text = 'Add an at symbol before worker';
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseRuntime);

      expect(decision.tier).toBe('default');
      expect(decision.triggeredRules).toContain('symbols');
    });

    it('routes to default model for casing triggers', () => {
      const text = 'Make this uppercase please';
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseRuntime);

      expect(decision.tier).toBe('default');
      expect(decision.triggeredRules).toContain('casing');
    });

    it('routes to default model for disfluency triggers', () => {
      const text = 'Turn left sorry turn right';
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseRuntime);

      expect(decision.tier).toBe('default');
      expect(decision.triggeredRules).toContain('disfluency');
    });

    it('routes to default for list triggers', () => {
      const text = 'Tasks: 1 buy milk, 2 walk dog, 3 finish report';
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseRuntime);

      expect(decision.tier).toBe('default');
      expect(decision.triggeredRules).toContain('list');
    });

    it('includes all triggered rules in reason', () => {
      const text = 'Make it uppercase and add an at symbol';
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseRuntime);

      expect(decision.tier).toBe('default');
      expect(decision.triggeredRules).toContain('casing');
      expect(decision.triggeredRules).toContain('symbols');
      expect(decision.reason).toContain('casing');
      expect(decision.reason).toContain('symbols');
    });
  });

  describe('selectSmartRoute - advanced tier', () => {
    it('routes long text WITH triggers to advanced model by character count', () => {
      const longText = 'Please make this uppercase. ' + 'a'.repeat(1300);
      const triggerContext = detectTriggers(longText);
      const decision = selectSmartRoute(longText, triggerContext, baseRuntime);

      expect(decision.tier).toBe('advanced');
      expect(decision.provider).toBe('cerebras');
      expect(decision.model).toBe('kimi-k2-instruct');
      expect(decision.temperature).toBe(0.3);
      expect(decision.reason).toContain('long_with_triggers');
      expect(decision.triggeredRules).toContain('casing');
    });

    it('routes long text WITH triggers to advanced model by word count', () => {
      const longText = 'Add an at symbol here. ' + Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
      const triggerContext = detectTriggers(longText);
      const decision = selectSmartRoute(longText, triggerContext, baseRuntime);

      expect(decision.tier).toBe('advanced');
      expect(decision.reason).toContain('long_with_triggers');
      expect(decision.triggeredRules).toContain('symbols');
    });

    it('bypasses LLM for long text WITHOUT triggers', () => {
      const longCleanText = Array.from({ length: 200 }, (_, i) => `sentence${i}`).join(' ');
      const triggerContext = detectTriggers(longCleanText);
      const decision = selectSmartRoute(longCleanText, triggerContext, baseRuntime);

      // Long text WITHOUT triggers should still bypass
      expect(decision.tier).toBe('bypass');
      expect(decision.triggeredRules).toEqual([]);
    });

    it('upgrades from default to advanced for long text with triggers', () => {
      const longTextWithTriggers = 'Please spell it as S-P-O-K-E. ' + 'a'.repeat(1200);
      const triggerContext = detectTriggers(longTextWithTriggers);
      const decision = selectSmartRoute(longTextWithTriggers, triggerContext, baseRuntime);

      expect(decision.tier).toBe('advanced');
      expect(decision.triggeredRules).toContain('spelling');
      expect(decision.reason).toContain('long_with_triggers');
    });
  });

  describe('selectSmartRoute - router disabled', () => {
    it('always uses default model when router is disabled', () => {
      const disabledRuntime = {
        ...baseRuntime,
        llm: { ...baseRuntime.llm, routerEnabled: false },
      };

      const cleanText = 'Normal text with no triggers';
      const triggerContext = detectTriggers(cleanText);
      const decision = selectSmartRoute(cleanText, triggerContext, disabledRuntime);

      expect(decision.tier).toBe('default');
      expect(decision.reason).toBe('router_disabled');
    });

    it('uses default even for long text when router disabled', () => {
      const disabledRuntime = {
        ...baseRuntime,
        llm: { ...baseRuntime.llm, routerEnabled: false },
      };

      const longText = 'a'.repeat(1500);
      const triggerContext = detectTriggers(longText);
      const decision = selectSmartRoute(longText, triggerContext, disabledRuntime);

      expect(decision.tier).toBe('default');
      expect(decision.reason).toBe('router_disabled');
    });
  });

  describe('selectEditRoute', () => {
    it('always returns edit tier', () => {
      const decision = selectEditRoute(baseRuntime);

      expect(decision.tier).toBe('edit');
      expect(decision.provider).toBe('cerebras');
      expect(decision.model).toBe('kimi-k2-instruct');
      expect(decision.temperature).toBe(0.6);
      expect(decision.reason).toBe('edit_mode');
    });

    it('uses edit config values', () => {
      const customRuntime: RuntimeConfig = {
        ...baseRuntime,
        edit: {
          enabled: true,
          stream: false,
          model: 'custom-edit-model',
          temperature: 0.8,
          timeoutMs: 40_000,
          provider: 'openai',
        },
      };

      const decision = selectEditRoute(customRuntime);

      expect(decision.provider).toBe('openai');
      expect(decision.model).toBe('custom-edit-model');
      expect(decision.temperature).toBe(0.8);
      expect(decision.timeoutMs).toBe(40_000);
      expect(decision.stream).toBe(false);
    });
  });
});
