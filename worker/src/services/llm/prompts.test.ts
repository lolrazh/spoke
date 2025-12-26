import { describe, it, expect } from 'vitest';
import { composeDynamicPrompt, estimatePromptTokens, getPromptStats } from './prompts';
import { detectTriggers } from './triggers';

describe('services/llm/prompts', () => {
  describe('composeDynamicPrompt', () => {
    it('includes only base prompt for clean dictation', () => {
      const triggerContext = detectTriggers('This is a normal sentence with no special instructions');
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain('You are a verbatim ASR cleaner');
      expect(prompt).toContain('<rules>');
      expect(prompt).not.toContain('spell something a certain way');
      expect(prompt).not.toContain('symbol by name');
      expect(prompt).not.toContain('corrects themselves');
      expect(prompt).not.toContain('<examples>');
    });

    it('includes spelling module when spelling trigger fires', () => {
      const triggerContext = detectTriggers('Please spell that as S-P-O-K-E');
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain('You are a verbatim ASR cleaner');
      expect(prompt).toContain('spell something a certain way');
      expect(prompt).toContain('<examples>');
      expect(prompt).toContain('Celero VAD');
      expect(prompt).not.toContain('symbol by name');
    });

    it('includes symbols module when symbol trigger fires', () => {
      const triggerContext = detectTriggers('Add an at symbol before worker');
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain('symbol by name');
      expect(prompt).toContain('<examples>');
      expect(prompt).toContain('@Groq');
      expect(prompt).not.toContain('spell something a certain way');
    });

    it('includes casing module when casing trigger fires', () => {
      const triggerContext = detectTriggers('Make this uppercase please');
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain('casing instructions');
      expect(prompt).toContain('<examples>');
      expect(prompt).not.toContain('symbol by name');
    });

    it('includes quotes module when quote trigger fires', () => {
      const triggerContext = detectTriggers('Put the word in quotes');
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain('quote-unquote');
      // No examples yet for quotes (user will provide better ones)
    });

    it('includes disfluency module when disfluency trigger fires', () => {
      const triggerContext = detectTriggers('Turn left sorry turn right');
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain('corrects themselves');
      expect(prompt).toContain('<examples>');
      expect(prompt).toContain('option key');
    });

    it('includes lists module when list trigger fires', () => {
      const triggerContext = detectTriggers('Tasks: 1 buy milk, 2 walk dog, 3 finish report');
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain('Auto-format as a list');
      // No examples for lists per user request
    });

    it('includes multiple modules when multiple triggers fire', () => {
      const triggerContext = detectTriggers('Make it uppercase and add an at symbol, also spell C L A U D E');
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain('casing instructions');
      expect(prompt).toContain('symbol by name');
      expect(prompt).toContain('spell something a certain way');
      expect(prompt).toContain('<examples>');
      expect(prompt).toContain('@Groq');
      expect(prompt).toContain('CLAUDE.md');
    });

    it('includes vocabulary when provided', () => {
      const triggerContext = detectTriggers('Normal text');
      const prompt = composeDynamicPrompt(triggerContext, {
        vocabulary: 'Spoke, Claude, Supabase',
      });

      expect(prompt).toContain('<vocabulary>');
      expect(prompt).toContain('Spoke, Claude, Supabase');
    });

    it('omits vocabulary section when not provided', () => {
      const triggerContext = detectTriggers('Normal text');
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).not.toContain('<vocabulary>');
    });
  });

  describe('estimatePromptTokens', () => {
    it('returns reasonable token estimate', () => {
      const text = 'This is a test sentence with about twenty characters per word on average.';
      const tokens = estimatePromptTokens(text);

      // Rough estimate: ~4 chars per token
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length); // Should be less than char count
    });

    it('estimates larger prompts correctly', () => {
      const triggerContext = detectTriggers('spell C L A U D E');
      const prompt = composeDynamicPrompt(triggerContext);
      const tokens = estimatePromptTokens(prompt);

      expect(tokens).toBeGreaterThan(100); // Should have meaningful content
      expect(tokens).toBeLessThan(1000); // But not excessive
    });
  });

  describe('getPromptStats', () => {
    it('returns stats for clean dictation', () => {
      const triggerContext = detectTriggers('This is normal text');
      const stats = getPromptStats(triggerContext);

      expect(stats.hasLLMBypass).toBe(true);
      expect(stats.triggeredModules).toEqual([]);
      expect(stats.dynamicTokens).toBeGreaterThan(0);
      expect(stats.dynamicPrompt).toContain('You are a verbatim ASR cleaner');
    });

    it('returns stats with triggered modules', () => {
      const triggerContext = detectTriggers('Add an at symbol and spell C L A U D E');
      const stats = getPromptStats(triggerContext);

      expect(stats.hasLLMBypass).toBe(false);
      expect(stats.triggeredModules).toContain('symbols');
      expect(stats.triggeredModules).toContain('spelling');
      expect(stats.dynamicTokens).toBeGreaterThan(0);
    });

    it('includes vocabulary in token count', () => {
      const triggerContext = detectTriggers('Normal text');
      const statsWithoutVocab = getPromptStats(triggerContext);
      const statsWithVocab = getPromptStats(triggerContext, {
        vocabulary: 'A very long vocabulary list with many proper nouns and technical terms',
      });

      expect(statsWithVocab.dynamicTokens).toBeGreaterThan(statsWithoutVocab.dynamicTokens);
    });
  });

  describe('token savings comparison', () => {
    it('shows significant savings for clean dictation vs full prompt', () => {
      const cleanContext = detectTriggers('This is a normal sentence');
      const fullContext = detectTriggers('Make it uppercase, add symbols, spell C L A U D E, quote it, sorry I mean add lists: 1 first, 2 second, 3 third');

      const cleanStats = getPromptStats(cleanContext);
      const fullStats = getPromptStats(fullContext);

      // Clean dictation should use fewer tokens
      expect(cleanStats.dynamicTokens).toBeLessThan(fullStats.dynamicTokens);

      // Clean should have no modules, full should have many
      expect(cleanStats.triggeredModules.length).toBe(0);
      expect(fullStats.triggeredModules.length).toBeGreaterThan(3);
    });

    it('saves ~30-40% tokens for single trigger vs all triggers', () => {
      const singleTrigger = detectTriggers('spell C L A U D E');
      const allTriggers = detectTriggers('Make uppercase, add symbol, spell it, quote it, sorry, list: 1 a, 2 b, 3 c');

      const singleStats = getPromptStats(singleTrigger);
      const allStats = getPromptStats(allTriggers);

      const savings = 1 - (singleStats.dynamicTokens / allStats.dynamicTokens);

      // Should save at least 30% tokens
      expect(savings).toBeGreaterThan(0.3);
      expect(singleStats.triggeredModules.length).toBe(1);
      expect(allStats.triggeredModules.length).toBeGreaterThan(4);
    });
  });
});
