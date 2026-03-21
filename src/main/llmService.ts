/**
 * LLM Service
 *
 * Chat completion calls for OpenAI and Groq, used by the enhancement
 * pipeline. Uses the same API keys as the STT providers via providerStore.
 */

import {
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  type ApiKeyTranscriptionProviderId,
} from "../core/transcription/providerCatalog";
import { getRequiredProviderApiKey } from "./providerStore";

// ── Types ─────────────────────────────────────────────────────────────

export interface ChatCompleteOptions {
  systemPrompt: string;
  userContent: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface ChatCompleteResult {
  text: string;
  model: string;
  provider: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 25_000;

// ── Chat Complete Dispatcher ──────────────────────────────────────────

export type LlmProviderId = "openai-cloud" | "groq-cloud";

/**
 * Resolve which provider to use for LLM enhancement.
 * Returns the provider ID if a compatible key is configured, null otherwise.
 */
export function resolveEnhancementProvider(
  preferredSttProviderId: string,
): LlmProviderId | null {
  // If the STT provider supports chat completions, use it
  if (
    preferredSttProviderId === OPENAI_CLOUD_PROVIDER_ID ||
    preferredSttProviderId === GROQ_CLOUD_PROVIDER_ID
  ) {
    return preferredSttProviderId as LlmProviderId;
  }

  // Otherwise, check if any compatible key is configured
  try {
    getRequiredProviderApiKey(GROQ_CLOUD_PROVIDER_ID);
    return GROQ_CLOUD_PROVIDER_ID;
  } catch {
    // no groq key
  }

  try {
    getRequiredProviderApiKey(OPENAI_CLOUD_PROVIDER_ID);
    return OPENAI_CLOUD_PROVIDER_ID;
  } catch {
    // no openai key
  }

  return null;
}

/**
 * Send a chat completion request to the specified provider.
 */
export async function chatComplete(
  providerId: LlmProviderId,
  opts: ChatCompleteOptions,
): Promise<ChatCompleteResult> {
  if (providerId === OPENAI_CLOUD_PROVIDER_ID) {
    return chatCompleteOpenAi(opts);
  }
  if (providerId === GROQ_CLOUD_PROVIDER_ID) {
    return chatCompleteGroq(opts);
  }
  throw new Error(`Unsupported LLM provider: ${providerId}`);
}

// ── OpenAI ────────────────────────────────────────────────────────────

async function chatCompleteOpenAi(
  opts: ChatCompleteOptions,
): Promise<ChatCompleteResult> {
  const model = opts.model ?? OPENAI_DEFAULT_MODEL;
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getRequiredProviderApiKey(OPENAI_CLOUD_PROVIDER_ID as ApiKeyTranscriptionProviderId)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userContent },
        ],
        temperature,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`OpenAI chat error: ${response.status} ${errorText}`);
    }

    const json = (await response.json()) as any;
    const text = json?.choices?.[0]?.message?.content ?? "";

    return { text, model, provider: "openai-cloud" };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Groq ──────────────────────────────────────────────────────────────

async function chatCompleteGroq(
  opts: ChatCompleteOptions,
): Promise<ChatCompleteResult> {
  const model = opts.model ?? GROQ_DEFAULT_MODEL;
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getRequiredProviderApiKey(GROQ_CLOUD_PROVIDER_ID as ApiKeyTranscriptionProviderId)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userContent },
        ],
        temperature,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Groq chat error: ${response.status} ${errorText}`);
    }

    const json = (await response.json()) as any;
    const text = json?.choices?.[0]?.message?.content ?? "";

    return { text, model, provider: "groq-cloud" };
  } finally {
    clearTimeout(timeoutId);
  }
}
