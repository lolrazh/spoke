import { detectTriggers } from "../services/llm/triggers";
import {
  selectSmartRoute,
  selectEditRoute,
} from "../services/llm/smartRouting";
import type { ConnectionContext, RouteDecision } from "./types";

/**
 * Decides whether to bypass LLM or which tier to use
 *
 * Flow:
 * 1. Edit mode → always use edit tier
 * 2. LLM disabled → bypass
 * 3. Detect triggers → route to appropriate tier
 */
export function routeTranscript(
  ctx: ConnectionContext,
  sttText: string,
): RouteDecision {
  const { session, runtime } = ctx;

  // Edit mode: always use edit tier
  if (session.mode === "edit" && runtime.edit.enabled) {
    const editRoute = selectEditRoute(runtime);
    return {
      tier: "edit",
      requiresLLM: true,
      provider: editRoute.provider,
      model: editRoute.model,
      temperature: runtime.edit.temperature,
      timeoutMs: runtime.edit.timeoutMs,
      stream: runtime.edit.stream,
      triggeredRules: [],
      reason: "edit mode",
    };
  }

  // LLM disabled: bypass
  if (!runtime.llm.enabled) {
    return {
      tier: "bypass",
      requiresLLM: false,
      triggeredRules: [],
      reason: "llm disabled",
    };
  }

  // Detect triggers
  const triggerContext = detectTriggers(sttText);
  const routeDecision = selectSmartRoute(sttText, triggerContext, runtime);

  // Bypass tier: no LLM needed
  if (routeDecision.tier === "bypass") {
    return {
      tier: "bypass",
      requiresLLM: false,
      triggeredRules: routeDecision.triggeredRules,
      reason: routeDecision.reason,
    };
  }

  // Default or advanced tier: LLM needed
  return {
    tier: routeDecision.tier,
    requiresLLM: true,
    provider: routeDecision.provider,
    model: routeDecision.model,
    temperature: routeDecision.temperature ?? runtime.llm.temperature,
    timeoutMs: routeDecision.timeoutMs,
    stream: routeDecision.stream ?? runtime.llm.stream,
    triggeredRules: routeDecision.triggeredRules,
    reason: `triggers: ${routeDecision.triggeredRules.join(", ") || "none"}`,
  };
}
