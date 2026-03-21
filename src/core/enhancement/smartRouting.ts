/**
 * Smart LLM routing with trigger-based detection
 * Routes transcriptions to the appropriate model tier or bypasses LLM entirely
 *
 * Adapted from worker/src/services/llm/smartRouting.ts for Electron main process.
 */

import type { EnhancementConfig, RoutingDecision } from "./types";
import type { TriggerContext } from "./triggers";

const LENGTH_THRESHOLD_CHARS = 1200;
const LENGTH_THRESHOLD_WORDS = 180;

/**
 * Smart routing for transcription post-processing
 *
 * Decision tree:
 * 1. No triggers detected → BYPASS (no LLM, use raw STT - even if long!)
 * 2. Spelling trigger detected → ADVANCED model (always, regardless of length)
 * 3. Other triggers + long text (>1200 chars) → ADVANCED model (upgrade from default)
 * 4. Other triggers + normal length → DEFAULT model (fast)
 */
export function selectSmartRoute(
  text: string,
  triggerContext: TriggerContext,
  config: EnhancementConfig,
): RoutingDecision {
  const normalized = text.trim();

  // Router disabled → always use default model
  if (!config.routerEnabled) {
    return {
      tier: "default",
      provider: config.provider,
      model: config.model,
      temperature: config.temperature,
      timeoutMs: config.timeoutMs,
      triggeredRules: [],
      reason: "router_disabled",
    };
  }

  // No triggers detected → BYPASS (regardless of length)
  if (!triggerContext.requiresLLM) {
    return {
      tier: "bypass",
      provider: undefined,
      model: undefined,
      temperature: undefined,
      timeoutMs: undefined,
      triggeredRules: [],
      reason: "no_triggers_detected",
    };
  }

  // Triggers detected - now check if we need advanced model
  const triggeredRules = Array.from(triggerContext.triggers);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const isLong =
    normalized.length >= LENGTH_THRESHOLD_CHARS ||
    wordCount >= LENGTH_THRESHOLD_WORDS;
  const hasSpelling = triggerContext.triggers.has("spelling");

  // Spelling trigger → ADVANCED model (always)
  if (hasSpelling) {
    return {
      tier: "advanced",
      provider: config.advancedProvider ?? config.provider,
      model: config.advancedModel ?? config.model,
      temperature: config.advancedTemperature ?? config.temperature,
      timeoutMs: config.advancedTimeoutMs ?? config.timeoutMs,
      triggeredRules,
      reason: "spelling_trigger",
    };
  }

  // Triggers + long text → ADVANCED model
  if (isLong) {
    return {
      tier: "advanced",
      provider: config.advancedProvider ?? config.provider,
      model: config.advancedModel ?? config.model,
      temperature: config.advancedTemperature ?? config.temperature,
      timeoutMs: config.advancedTimeoutMs ?? config.timeoutMs,
      triggeredRules,
      reason: `long_with_triggers_${normalized.length}_chars_${wordCount}_words`,
    };
  }

  // Triggers detected, normal length → DEFAULT model (fast)
  return {
    tier: "default",
    provider: config.provider,
    model: config.model,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
    triggeredRules,
    reason: `triggers_detected_${triggeredRules.join("_")}`,
  };
}

/**
 * Routing decision for edit mode — always uses the edit tier
 */
export function selectEditRoute(config: EnhancementConfig): RoutingDecision {
  return {
    tier: "edit",
    provider: config.editProvider ?? config.provider,
    model: config.editModel ?? config.model,
    temperature: config.editTemperature ?? config.temperature,
    timeoutMs: config.editTimeoutMs ?? config.timeoutMs,
    triggeredRules: [],
    reason: "edit_mode",
  };
}
