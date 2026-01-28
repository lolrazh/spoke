import {
  GROQ_OCR_ENDPOINT,
  GROQ_OCR_MODEL,
  OCR_DEFAULT_TIMEOUT_MS,
  OCR_MAX_WORDS,
} from "../../config.js";
import { safeJson } from "../../utils/safe.js";
import { OCR_SYSTEM_PROMPT } from "./prompt.js";
import type { OcrResult } from "./types.js";

export interface ExtractOcrWordsOptions {
  apiKey: string;
  imageBase64: string;
  model?: string;
  timeoutMs?: number;
  maxWords?: number;
}

export async function extractOcrWords(
  opts: ExtractOcrWordsOptions,
): Promise<OcrResult> {
  const {
    apiKey,
    imageBase64,
    model = GROQ_OCR_MODEL,
    timeoutMs = OCR_DEFAULT_TIMEOUT_MS,
    maxWords = OCR_MAX_WORDS,
  } = opts;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
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

    const res = await fetch(GROQ_OCR_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(`[OCR] Groq error: ${res.status} ${errorText}`);
      return { words: [] };
    }

    const json = (await res.json()) as any;
    const content = json?.choices?.[0]?.message?.content ?? "";

    if (!content) {
      console.warn("[OCR] No content in response");
      return { words: [] };
    }

    // Parse JSON response
    const parsed = safeJson<OcrResult>(content);

    if (!parsed || !Array.isArray(parsed.words)) {
      console.warn("[OCR] Invalid JSON response:", content);
      return { words: [] };
    }

    // Limit to maxWords and deduplicate
    const uniqueWords = Array.from(new Set(parsed.words));
    const limitedWords = uniqueWords.slice(0, maxWords);

    return { words: limitedWords };
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
