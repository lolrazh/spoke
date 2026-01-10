import {
  prepareEditRequest,
  buildEditSystemPrompt,
} from "../services/llm/editPrompt";
import {
  composeDynamicPrompt,
  estimatePromptTokens,
} from "../services/llm/prompts";
import { detectTriggers } from "../services/llm/triggers";
import { logSessionLLM } from "../utils/sessionLogger";
import { safely } from "../utils/safely";
import type { ConnectionContext, RouteDecision, EnhanceResult } from "./types";

/**
 * Enhances transcript with LLM
 *
 * THIS MODULE IS LAZY LOADED - only imported when tier !== "bypass"
 *
 * @param ctx - Connection context
 * @param sttText - Raw STT output
 * @param route - Router decision
 * @param sttPrompt - Original STT prompt (for vocabulary)
 */
export async function enhance(
  ctx: ConnectionContext,
  sttText: string,
  route: RouteDecision,
  sttPrompt: string,
): Promise<EnhanceResult> {
  const { session, runtime, env, server } = ctx;

  // Bypass case (shouldn't reach here, but safety check)
  if (!route.requiresLLM) {
    return { text: sttText, bypassed: true };
  }

  // Lazy import LLM module
  const { chatCompleteByProvider } = await import("../services/llm");

  // Notify client
  safely(() =>
    server.send(
      JSON.stringify({
        type: "llm_status",
        state: "llm_processing",
        traceId: session.traceId,
        serverTs: Date.now(),
      }),
    ),
  );

  const routerStartTime = Date.now();

  // Get API key for provider
  const apiKey = getApiKeyForProvider(env, route.provider!);
  if (!apiKey) {
    console.warn(`[LLM] Missing API key for provider: ${route.provider}`);
    return { text: sttText, bypassed: true };
  }

  // Build prompt based on mode
  let systemPrompt: string;
  let userContent: string;

  if (route.tier === "edit") {
    const editPlan = prepareEditRequest({
      instructions: sttText,
      selection: session.selection,
    });
    systemPrompt = buildEditSystemPrompt({ sttPrompt });
    userContent = editPlan?.prompt ?? sttText;
  } else {
    const triggerContext = detectTriggers(sttText);
    systemPrompt = composeDynamicPrompt(triggerContext, {
      vocabulary: sttPrompt,
      model: route.model!,
      currentDate: runtime.llm.currentDate,
    });
    userContent = sttText;
  }

  const promptTokens = estimatePromptTokens(systemPrompt);
  const llmStartTime = Date.now();
  ctx.timing.routerOverheadMs = llmStartTime - routerStartTime;

  // Call LLM
  const result = await chatCompleteByProvider(route.provider as any, {
    apiKey,
    model: route.model,
    systemPrompt,
    userContent,
    stream: route.stream,
    temperature: route.temperature,
    timeoutMs: route.timeoutMs,
    signal: ctx.abortController?.signal,
    onDelta: route.stream
      ? (delta) => {
          if (!ctx.socketClosed && delta) {
            safely(() =>
              server.send(
                JSON.stringify({
                  type: "llm_delta",
                  delta,
                  traceId: session.traceId,
                }),
              ),
            );
          }
        }
      : undefined,
  });

  const llmDuration = Date.now() - llmStartTime;
  const ttfb = result.timings
    ? (result.timings.firstDeltaAt ?? result.timings.headersAt) -
      result.timings.startAt
    : 0;

  // Track timing
  ctx.timing.llmDurationMs = llmDuration;
  ctx.timing.llmTtfbMs = ttfb;

  // Log LLM completion
  logSessionLLM({
    outcome: "success",
    provider: route.provider!,
    model: route.model!,
    duration_ms: llmDuration,
    ttfb_ms: ttfb,
    router_overhead_ms: ctx.timing.routerOverheadMs,
    text_length: result.text.length,
    trace_id: session.traceId ?? "unknown",
  });

  return {
    text: result.text || sttText,
    bypassed: false,
    timings: result.timings,
    provider: route.provider,
    model: route.model,
  };
}

function getApiKeyForProvider(env: any, provider: string): string | undefined {
  switch (provider) {
    case "groq":
      return env.GROQ_API_KEY;
    case "baseten":
      return env.BASETEN_API_KEY;
    case "cerebras":
      return env.CEREBRAS_API_KEY;
    case "simplismart":
      return env.SIMPLISMART_API_KEY;
    default:
      return undefined;
  }
}
