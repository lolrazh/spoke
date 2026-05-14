/**
 * Enhancement Service
 *
 * Orchestrates the full enhancement pipeline in the Electron main process:
 * detect triggers → route → build prompt → call LLM → return enhanced text.
 */

import { detectTriggers } from "../core/enhancement/triggers";
import {
  selectSmartRoute,
  selectEditRoute,
} from "../core/enhancement/smartRouting";
import { composeDynamicPrompt } from "../core/enhancement/prompts";
import {
  buildEditSystemPrompt,
  buildEditPrompt,
} from "../core/enhancement/editPrompt";
import type {
  EnhancementConfig,
  EnhanceResult,
} from "../core/enhancement/types";
import {
  chatComplete,
  resolveEnhancementProvider,
  type LlmProviderId,
} from "./llmService";
import { getPreferredProviderId } from "./providerStore";

// ── Default Config ────────────────────────────────────────────────────

const DEFAULT_CONFIG: EnhancementConfig = {
  enabled: true,
  routerEnabled: true,
  provider: "groq-cloud",
  model: "llama-3.3-70b-versatile",
  temperature: 0.2,
  timeoutMs: 25_000,
  advancedModel: "llama-3.3-70b-versatile",
  advancedTemperature: 0.3,
  advancedTimeoutMs: 30_000,
  editModel: "llama-3.3-70b-versatile",
  editTemperature: 0.6,
  editTimeoutMs: 30_000,
};

// ── Types ─────────────────────────────────────────────────────────────

export interface EnhanceOptions {
  /** OCR-extracted vocabulary words */
  vocabulary?: string[];
  /** Transcription mode */
  mode?: "dictation" | "edit";
  /** Selected text for edit mode */
  selectionText?: string;
}

// ── Enhancement ───────────────────────────────────────────────────────

/**
 * Enhance raw transcript text using the trigger-based LLM pipeline.
 *
 * Returns the original text if:
 * - No LLM provider is configured
 * - No triggers are detected (bypass — 90% of cases)
 * - LLM call fails (return the original transcript)
 */
export async function enhance(
  rawText: string,
  options: EnhanceOptions = {},
): Promise<EnhanceResult> {
  const text = rawText.trim();
  if (!text) {
    return { text: "", bypassed: true };
  }

  // Resolve which provider to use for LLM
  const sttProviderId = getPreferredProviderId();
  const llmProviderId = resolveEnhancementProvider(sttProviderId);

  if (!llmProviderId) {
    console.log("[Enhance] No LLM provider available, bypassing");
    return { text, bypassed: true };
  }

  // Edit mode
  if (options.mode === "edit" && options.selectionText) {
    return enhanceEdit(text, options.selectionText, llmProviderId, options);
  }

  // Dictation mode — detect triggers
  const triggerContext = detectTriggers(text);

  if (!triggerContext.requiresLLM) {
    return { text, bypassed: true };
  }

  // Route to appropriate model tier
  const config: EnhancementConfig = {
    ...DEFAULT_CONFIG,
    provider: llmProviderId,
    advancedProvider: llmProviderId,
  };
  const route = selectSmartRoute(text, triggerContext, config);

  if (route.tier === "bypass") {
    return { text, bypassed: true };
  }

  // Build dynamic prompt
  const vocabulary = options.vocabulary?.join(", ");
  const systemPrompt = composeDynamicPrompt(triggerContext, { vocabulary });

  try {
    console.log(
      `[Enhance] Calling LLM: provider=${route.provider}, model=${route.model}, tier=${route.tier}`,
    );
    const result = await chatComplete(route.provider as LlmProviderId, {
      systemPrompt,
      userContent: text,
      model: route.model,
      temperature: route.temperature,
      timeoutMs: route.timeoutMs,
    });

    const enhanced = result.text.trim();
    if (!enhanced) {
      console.warn("[Enhance] LLM returned empty text, using raw transcript");
      return { text, bypassed: true };
    }

    return {
      text: enhanced,
      bypassed: false,
      tier: route.tier,
      provider: result.provider,
      model: result.model,
    };
  } catch (error) {
    console.error(
      "[Enhance] LLM call failed, returning raw transcript:",
      error,
    );
    return { text, bypassed: true };
  }
}

// ── Edit Mode ─────────────────────────────────────────────────────────

async function enhanceEdit(
  instructions: string,
  selectionText: string,
  llmProviderId: LlmProviderId,
  options: EnhanceOptions,
): Promise<EnhanceResult> {
  const vocabulary = options.vocabulary?.join(", ");
  const systemPrompt = buildEditSystemPrompt({ vocabulary });
  const userContent = buildEditPrompt({
    instructions,
    originalText: selectionText,
  });

  const config: EnhancementConfig = {
    ...DEFAULT_CONFIG,
    editProvider: llmProviderId,
  };
  const route = selectEditRoute(config);

  try {
    console.log(
      `[Enhance] Edit mode: provider=${route.provider}, model=${route.model}`,
    );
    const result = await chatComplete(route.provider as LlmProviderId, {
      systemPrompt,
      userContent,
      model: route.model,
      temperature: route.temperature,
      timeoutMs: route.timeoutMs,
    });

    const enhanced = result.text.trim();
    if (!enhanced) {
      console.warn("[Enhance] LLM returned empty edit result");
      return { text: selectionText, bypassed: true };
    }

    return {
      text: enhanced,
      bypassed: false,
      tier: "edit",
      provider: result.provider,
      model: result.model,
    };
  } catch (error) {
    console.error("[Enhance] Edit LLM call failed:", error);
    return { text: selectionText, bypassed: true };
  }
}
