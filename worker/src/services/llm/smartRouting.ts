/**
 * Smart LLM routing with trigger-based detection
 * Routes transcriptions to the appropriate model tier or bypasses LLM entirely
 */

import type { RuntimeConfig } from '../../config/runtime';
import type { TriggerContext } from './triggers';
import type { LLMProvider } from '../../config';

export type ModelTier = 'bypass' | 'default' | 'advanced' | 'edit';

export interface SmartRoutingDecision {
  /** Which model tier to use */
  tier: ModelTier;

  /** LLM provider to use (undefined if bypass) */
  provider?: LLMProvider;

  /** LLM model to use (undefined if bypass) */
  model?: string;

  /** Temperature for LLM (undefined if bypass) */
  temperature?: number;

  /** Timeout for LLM (undefined if bypass) */
  timeoutMs?: number;

  /** Whether to stream LLM response (undefined if bypass) */
  stream?: boolean;

  /** Triggers that fired (empty if bypass) */
  triggeredRules: string[];

  /** Why this routing decision was made */
  reason: string;
}

const LENGTH_THRESHOLD_CHARS = 1200;
const LENGTH_THRESHOLD_WORDS = 180;

/**
 * Smart routing for transcription post-processing
 *
 * Decision tree:
 * 1. No triggers detected → BYPASS (no LLM, use raw STT)
 * 2. Long text (>1200 chars) → ADVANCED model
 * 3. Triggers detected → DEFAULT model (fast)
 *
 * Note: Edit mode should call this separately and always use EDIT tier
 *
 * @param text - STT output text
 * @param triggerContext - Detected triggers from detectTriggers()
 * @param runtime - Runtime configuration
 * @returns Routing decision
 */
export function selectSmartRoute(
  text: string,
  triggerContext: TriggerContext,
  runtime: RuntimeConfig
): SmartRoutingDecision {
  const normalized = text.trim();

  // Router disabled → always use default model
  if (!runtime.llm.routerEnabled) {
    return {
      tier: 'default',
      provider: runtime.llm.provider,
      model: runtime.llm.model,
      temperature: runtime.llm.temperature,
      timeoutMs: runtime.llm.timeoutMs,
      stream: runtime.llm.stream,
      triggeredRules: [],
      reason: 'router_disabled',
    };
  }

  const triggeredRules = Array.from(triggerContext.triggers);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const isLong = normalized.length >= LENGTH_THRESHOLD_CHARS || wordCount >= LENGTH_THRESHOLD_WORDS;

  // Long text → ADVANCED model (smarter, slower) - regardless of triggers
  if (isLong) {
    return {
      tier: 'advanced',
      provider: runtime.advanced.provider,
      model: runtime.advanced.model,
      temperature: runtime.advanced.temperature,
      timeoutMs: runtime.advanced.timeoutMs,
      stream: runtime.advanced.stream,
      triggeredRules,
      reason: `long_text_${normalized.length}_chars_${wordCount}_words`,
    };
  }

  // No triggers detected → BYPASS
  if (!triggerContext.requiresLLM) {
    return {
      tier: 'bypass',
      provider: undefined,
      model: undefined,
      temperature: undefined,
      timeoutMs: undefined,
      stream: undefined,
      triggeredRules: [],
      reason: 'no_triggers_detected',
    };
  }

  // Triggers detected, normal length → DEFAULT model (fast)
  return {
    tier: 'default',
    provider: runtime.llm.provider,
    model: runtime.llm.model,
    temperature: runtime.llm.temperature,
    timeoutMs: runtime.llm.timeoutMs,
    stream: runtime.llm.stream,
    triggeredRules,
    reason: `triggers_detected_${triggeredRules.join('_')}`,
  };
}

/**
 * Routing decision for edit mode (selected text transformation)
 * Always uses the EDIT tier
 */
export function selectEditRoute(runtime: RuntimeConfig): SmartRoutingDecision {
  return {
    tier: 'edit',
    provider: runtime.edit.provider,
    model: runtime.edit.model,
    temperature: runtime.edit.temperature,
    timeoutMs: runtime.edit.timeoutMs,
    stream: runtime.edit.stream,
    triggeredRules: [],
    reason: 'edit_mode',
  };
}
