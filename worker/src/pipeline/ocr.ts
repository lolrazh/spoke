import { extractOcrWords } from "../services/ocr/index";
import { logSessionOCR } from "../utils/sessionLogger";
import type { ConnectionContext } from "./types";

const MAX_OCR_IMAGE_BASE64_CHARS = 1_500_000; // ~1MB image

/**
 * Extracts OCR words from image (fire-and-forget)
 *
 * Note: This uses executionCtx.waitUntil() for async execution
 */
export async function extractOCR(
  ctx: ConnectionContext,
  imageBase64: string,
  executionCtx?: ExecutionContext,
): Promise<void> {
  const { session, env, runtime } = ctx;

  // Guardrails: prevent abusive payload sizes
  if (!imageBase64 || imageBase64.length > MAX_OCR_IMAGE_BASE64_CHARS) {
    logSessionOCR({
      outcome: "rejected",
      trace_id: session.traceId ?? "unknown",
    });
    return;
  }

  if (!env.GROQ_API_KEY) {
    logSessionOCR({
      outcome: "no_api_key",
      trace_id: session.traceId ?? "unknown",
    });
    return;
  }

  const task = (async () => {
    try {
      const startMs = Date.now();
      const result = await extractOcrWords({
        apiKey: env.GROQ_API_KEY,
        imageBase64,
      });
      const durationMs = Date.now() - startMs;

      session.ocrWords = result.words;
      session.ocrReceivedMs = Date.now();
      session.ocrPending = false;

      // Track OCR timing for consolidated logging
      ctx.timing.ocrDurationMs = durationMs;

      logSessionOCR({
        outcome: "success",
        duration_ms: durationMs,
        word_count: result.words.length,
        trace_id: session.traceId ?? "unknown",
      });
    } catch (error) {
      session.ocrPending = false;

      logSessionOCR({
        outcome: "error",
        error_message: error instanceof Error ? error.message : String(error),
        trace_id: session.traceId ?? "unknown",
      });
    }
  })();

  // If executionCtx is available, use waitUntil for proper lifecycle
  if (executionCtx) {
    executionCtx.waitUntil(task);
  } else {
    // Fire-and-forget fallback
    task.catch(() => {});
  }
}
