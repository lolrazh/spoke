/**
 * Dynamic prompt composer
 * Builds LLM prompts based on detected triggers to minimize token usage
 */

import type { TriggerContext } from '../triggers';
import { getBasePrompt } from './base';
import { getSpellingRules, getSpellingExamples } from './spelling';
import { getSymbolRules, getSymbolExamples } from './symbols';
import { getCasingRules, getCasingExamples } from './casing';
import { getQuoteRules, getQuoteExamples } from './quotes';
import { getCorrectionRules, getCorrectionExamples } from './corrections';
import { getListRules, getListExamples } from './lists';

export interface PromptComposerOptions {
  /** Vocabulary hint (from STT prompt) */
  vocabulary?: string;

  /** Model name (for potential model-specific optimizations) */
  model?: string;

  /** Current date for context */
  currentDate?: string;
}

/**
 * Composes a dynamic LLM system prompt based on detected triggers
 *
 * Strategy:
 * - Base prompt is ALWAYS included (core ASR rules)
 * - Additional modules are included ONLY if their triggers fired
 * - This reduces prompt token count by 60-80% for simple dictations
 *
 * @param triggerContext - Result from detectTriggers()
 * @param options - Additional prompt configuration
 * @returns Composed system prompt string
 */
export function composeDynamicPrompt(
  triggerContext: TriggerContext,
  options: PromptComposerOptions = {}
): string {
  const sections: string[] = [];

  // Always include base prompt
  sections.push(getBasePrompt(options.vocabulary));

  // Add triggered modules
  const { triggers } = triggerContext;

  if (triggers.has('spelling')) {
    sections.push(getSpellingRules());
  }

  if (triggers.has('symbols')) {
    sections.push(getSymbolRules());
  }

  if (triggers.has('casing')) {
    sections.push(getCasingRules());
  }

  if (triggers.has('quotes')) {
    sections.push(getQuoteRules());
  }

  if (triggers.has('disfluency')) {
    sections.push(getCorrectionRules());
  }

  if (triggers.has('list')) {
    sections.push(getListRules());
  }

  // Add examples section (only for triggered modules)
  const exampleSections: string[] = [];

  if (triggers.has('spelling')) {
    exampleSections.push(getSpellingExamples());
  }

  if (triggers.has('symbols')) {
    exampleSections.push(getSymbolExamples());
  }

  if (triggers.has('casing')) {
    exampleSections.push(getCasingExamples());
  }

  if (triggers.has('quotes')) {
    exampleSections.push(getQuoteExamples());
  }

  if (triggers.has('disfluency')) {
    exampleSections.push(getCorrectionExamples());
  }

  if (triggers.has('list')) {
    exampleSections.push(getListExamples());
  }

  // Combine all examples into a single <examples> block if any exist
  if (exampleSections.length > 0) {
    sections.push(`\n<examples>${exampleSections.join('\n')}\n</examples>`);
  }

  return sections.join('\n');
}

/**
 * Helper to estimate token count for prompt (rough approximation)
 * Assumes ~4 characters per token on average
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

/**
 * Compares dynamic prompt with monolithic prompt and returns stats
 */
export function getPromptStats(triggerContext: TriggerContext, options: PromptComposerOptions = {}): {
  dynamicPrompt: string;
  dynamicTokens: number;
  triggeredModules: string[];
  hasLLMBypass: boolean;
} {
  const dynamicPrompt = composeDynamicPrompt(triggerContext, options);
  const dynamicTokens = estimatePromptTokens(dynamicPrompt);
  const triggeredModules = Array.from(triggerContext.triggers);
  const hasLLMBypass = !triggerContext.requiresLLM;

  return {
    dynamicPrompt,
    dynamicTokens,
    triggeredModules,
    hasLLMBypass,
  };
}
