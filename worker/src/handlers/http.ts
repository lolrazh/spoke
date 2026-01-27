/**
 * HTTP Endpoints for Transcription
 *
 * Replaces WebSocket-based audio streaming with two HTTP endpoints:
 * - POST /prepare: Pre-flight auth check + OCR extraction (parallel with recording)
 * - POST /transcribe: Upload audio + transcribe + enhance
 *
 * This eliminates WebSocket backpressure issues while maintaining parallelization.
 */

import { Context } from "hono";
import { nanoid } from "nanoid";
import { getRuntimeConfig } from "../config/runtime";
import { extractOcrWords } from "../services/ocr";
import { transcribeOpus } from "../pipeline/transcribe";
import { routeTranscript } from "../pipeline/router";
import { enhance } from "../pipeline/enhance";
import { buildSTTPrompt } from "../services/stt/prompt";
import type { AuthContext } from "../middleware/auth";
import type { Bindings } from "../pipeline/types";

/**
 * POST /prepare
 *
 * Pre-flight endpoint called when recording starts.
 * Performs auth + quota check + OCR extraction in parallel with user speaking.
 *
 * Request body:
 * {
 *   screenshot?: string; // base64 image for OCR (optional)
 * }
 *
 * Response:
 * {
 *   prepareId: string;
 *   ocrWords?: string[];
 *   quotaInfo: { wordsUsed: number; quotaLimit: number };
 * }
 */
export async function handlePrepare(c: Context) {
  const auth = c.get("auth") as AuthContext;
  const requestId = c.get("requestId") as string;

  // Parse request body
  const body = await c.req.json().catch(() => ({}));
  const screenshot = body.screenshot as string | undefined;

  const prepareId = nanoid(10);
  const traceId = `prepare-${prepareId}`;

  console.log(`[HTTP /prepare] ${requestId} - User: ${auth.userId}`);

  // Extract OCR words if screenshot provided (fire-and-forget)
  let ocrWords: string[] = [];
  if (screenshot && c.env.GROQ_API_KEY) {
    try {
      const result = await extractOcrWords({
        apiKey: c.env.GROQ_API_KEY,
        imageBase64: screenshot,
      });
      ocrWords = result.words;
      console.log(
        `[HTTP /prepare] ${requestId} - OCR extracted ${ocrWords.length} words`,
      );
    } catch (err) {
      console.warn(`[HTTP /prepare] ${requestId} - OCR failed:`, err);
      // Continue without OCR (non-critical)
    }
  }

  // Return prepare result with quota info
  return c.json({
    prepareId,
    ocrWords: ocrWords.length > 0 ? ocrWords : undefined,
    quotaInfo: {
      wordsUsed: auth.wordsUsedThisWeek ?? 0,
      quotaLimit: auth.quotaLimit ?? 1000,
      subscriptionActive: auth.subscriptionActive,
    },
  });
}

/**
 * POST /transcribe
 *
 * Main transcription endpoint called when recording stops.
 * Accepts audio upload (Opus/webm), transcribes, routes, and enhances.
 *
 * Request: multipart/form-data
 * - audio: File (webm/opus)
 * - metadata: JSON string with { mode, ocrWords, selection, identity, language }
 *
 * Response (streaming if LLM enabled):
 * Server-Sent Events (SSE) stream with:
 * - event: stt_complete / llm_delta / llm_complete / error
 * - data: JSON payload
 *
 * Or JSON response if LLM disabled/bypass:
 * {
 *   text: string;
 *   mode: "dictation" | "edit";
 *   tier: "bypass" | "default" | "advanced" | "edit";
 * }
 */
export async function handleTranscribe(c: Context) {
  const auth = c.get("auth") as AuthContext;
  const requestId = c.get("requestId") as string;
  const env = c.env as Bindings;

  const traceId = `http-${requestId}`;
  console.log(`[HTTP /transcribe] ${requestId} - User: ${auth.userId}`);

  try {
    // Parse multipart form data
    const formData = await c.req.formData();
    const audioFile = formData.get("audio") as File | null;
    const metadataStr = formData.get("metadata") as string | null;

    if (!audioFile) {
      return c.json({ error: "Missing audio file" }, 400);
    }

    if (!metadataStr) {
      return c.json({ error: "Missing metadata" }, 400);
    }

    const metadata = JSON.parse(metadataStr) as {
      mode: "dictation" | "edit";
      ocrWords?: string[];
      selection?: string;
      identity?: string;
      language?: string;
    };

    console.log(
      `[HTTP /transcribe] ${requestId} - Audio: ${audioFile.size} bytes, Mode: ${metadata.mode}`,
    );

    // Get runtime config
    const runtime = getRuntimeConfig(env);

    // Create abort controller
    const abortController = new AbortController();

    // Transcribe audio (STT)
    const sttStartTime = Date.now();
    const transcribeResult = await transcribeOpus(audioFile, {
      runtime,
      env,
      identity: metadata.identity,
      ocrWords: metadata.ocrWords,
      language: metadata.language,
      signal: abortController.signal,
      traceId,
    });

    const sttDuration = Date.now() - sttStartTime;
    console.log(
      `[HTTP /transcribe] ${requestId} - STT complete: "${transcribeResult.text.substring(0, 50)}..." (${sttDuration}ms)`,
    );

    // Build STT prompt for LLM (vocabulary extraction)
    const sttPrompt = buildSTTPrompt({
      basePrompt: runtime.stt.prompt,
      identity: metadata.identity,
      ocrWords:
        metadata.ocrWords && metadata.ocrWords.length > 0
          ? metadata.ocrWords
          : undefined,
    });

    // Route transcript (decide if LLM needed)
    const routeDecision = routeTranscript(
      {
        session: {
          mode: metadata.mode,
          selection: metadata.selection,
        } as any,
        runtime,
      } as any,
      transcribeResult.text,
    );

    console.log(
      `[HTTP /transcribe] ${requestId} - Route: ${routeDecision.tier} (requiresLLM: ${routeDecision.requiresLLM})`,
    );

    // Bypass case: return immediately
    if (!routeDecision.requiresLLM) {
      // TODO: Log to analytics + increment quota
      return c.json({
        text: transcribeResult.text,
        mode: metadata.mode,
        tier: routeDecision.tier,
        provider: transcribeResult.provider,
        model: transcribeResult.model,
        traceId,
      });
    }

    // LLM enhancement needed
    const llmStartTime = Date.now();

    // For streaming, use SSE
    if (routeDecision.stream) {
      // Set up SSE headers
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          // Send STT complete event
          controller.enqueue(
            encoder.encode(
              `event: stt_complete\ndata: ${JSON.stringify({ text: transcribeResult.text })}\n\n`,
            ),
          );

          // Mock WebSocket for enhance() (it expects server.send())
          const mockServer = {
            send: (data: string) => {
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "llm_delta") {
                  controller.enqueue(
                    encoder.encode(
                      `event: llm_delta\ndata: ${JSON.stringify({ delta: parsed.delta })}\n\n`,
                    ),
                  );
                }
              } catch (err) {
                console.error("[HTTP /transcribe] Failed to parse delta:", err);
              }
            },
          };

          try {
            // Call enhance with mock server
            const enhanceResult = await enhance(
              {
                session: {
                  mode: metadata.mode,
                  selection: metadata.selection,
                  traceId,
                } as any,
                runtime,
                env,
                server: mockServer as any,
                socketClosed: false,
                timing: {} as any,
                abortController,
              } as any,
              transcribeResult.text,
              routeDecision,
              sttPrompt,
            );

            // Send LLM complete event
            controller.enqueue(
              encoder.encode(
                `event: llm_complete\ndata: ${JSON.stringify({ text: enhanceResult.text, tier: routeDecision.tier, traceId })}\n\n`,
              ),
            );

            controller.close();
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`,
              ),
            );
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Request-Id": requestId,
        },
      });
    }

    // Non-streaming: call enhance and return JSON
    const enhanceResult = await enhance(
      {
        session: {
          mode: metadata.mode,
          selection: metadata.selection,
          traceId,
        } as any,
        runtime,
        env,
        server: { send: () => {} } as any, // No-op server
        socketClosed: false,
        timing: {} as any,
        abortController,
      } as any,
      transcribeResult.text,
      routeDecision,
      sttPrompt,
    );

    const llmDuration = Date.now() - llmStartTime;
    console.log(
      `[HTTP /transcribe] ${requestId} - LLM complete: "${enhanceResult.text.substring(0, 50)}..." (${llmDuration}ms)`,
    );

    // TODO: Log to analytics + increment quota

    return c.json({
      text: enhanceResult.text,
      mode: metadata.mode,
      tier: routeDecision.tier,
      provider: transcribeResult.provider,
      model: transcribeResult.model,
      llmProvider: routeDecision.provider,
      llmModel: routeDecision.model,
      traceId,
    });
  } catch (err) {
    console.error(`[HTTP /transcribe] ${requestId} - Error:`, err);

    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json(
      {
        error: "Transcription failed",
        message: errorMsg,
        traceId,
      },
      500,
    );
  }
}
