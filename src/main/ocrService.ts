/**
 * OCR Service
 *
 * Extracts proper nouns from screenshots using vision APIs (Groq or OpenAI).
 * Used to build vocabulary for STT prompts and LLM enhancement.
 */

import {
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  type ApiKeyTranscriptionProviderId,
} from "../core/transcription/providerCatalog";
import { getRequiredProviderApiKey } from "./providerStore";
import type { LlmProviderId } from "./llmService";

// ── Constants ─────────────────────────────────────────────────────────

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_VISION_MODEL = "gpt-4o-mini";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const OCR_TIMEOUT_MS = 5_000;
const OCR_MAX_WORDS = 50;

const OCR_SYSTEM_PROMPT = `You are extracting proper nouns from a screenshot for speech recognition.

Extract ONLY:
- Person names (first, last)
- Company/brand names
- Product names
- Technical terms (APIs, functions, variables, libraries, tools)
- Unique identifiers (project names, file names)

Return JSON: {"words": ["Word1", "Word2", ...]}

Rules:
- No common words (the, and, is, etc.)
- No generic terms (button, window, menu)
- Deduplicate (no repeats)
- English words only
- If nothing notable found, return {"words": []}`;

// ── Types ─────────────────────────────────────────────────────────────

export interface OcrResult {
  words: string[];
}

// ── Main Function ─────────────────────────────────────────────────────

/**
 * Extract proper nouns from a screenshot using a vision API.
 * Returns empty array on failure (non-critical path).
 */
export async function extractOcrWords(
  imageBase64: string,
  providerId: LlmProviderId,
): Promise<OcrResult> {
  const endpoint =
    providerId === OPENAI_CLOUD_PROVIDER_ID ? OPENAI_CHAT_URL : GROQ_CHAT_URL;
  const model =
    providerId === OPENAI_CLOUD_PROVIDER_ID
      ? OPENAI_VISION_MODEL
      : GROQ_VISION_MODEL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  try {
    const apiKey = getRequiredProviderApiKey(
      providerId as ApiKeyTranscriptionProviderId,
    );

    const body = {
      model,
      messages: [
        {
          role: "system",
          content: OCR_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(
        `[OCR] API error: ${response.status}`,
        await response.text().catch(() => ""),
      );
      return { words: [] };
    }

    const json = (await response.json()) as any;
    const content = json?.choices?.[0]?.message?.content ?? "";

    if (!content) {
      console.warn("[OCR] No content in response");
      return { words: [] };
    }

    let parsed: { words?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn("[OCR] Invalid JSON response:", content);
      return { words: [] };
    }

    if (!Array.isArray(parsed.words)) {
      console.warn("[OCR] Response missing words array");
      return { words: [] };
    }

    // Deduplicate and limit
    const uniqueWords = Array.from(
      new Set(parsed.words.filter((w: unknown) => typeof w === "string")),
    ) as string[];

    return { words: uniqueWords.slice(0, OCR_MAX_WORDS) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("[OCR] Request timed out");
    } else {
      console.error("[OCR] Extract failed:", error);
    }
    return { words: [] };
  } finally {
    clearTimeout(timeoutId);
  }
}
