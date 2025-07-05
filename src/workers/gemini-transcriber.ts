// gemini-transcriber.ts
// import { GoogleGenAI } from '@google/genai';        // npm i @google/genai

// API key is no longer handled here; it's in the Cloudflare worker environment.
// Logging for API key status can be removed from here.

// The arrayBufferToBase64 helper is also not needed here anymore, as the worker handles it.

import { performance } from "node:perf_hooks"; // ESM style import

/**
 * Transcribes audio by sending it to a Cloudflare worker, which then calls the Gemini API.
 *
 * @param audioData   raw audio as ArrayBuffer
 * @param mimeType    e.g., 'audio/webm', 'audio/wav' – worker passes this to Gemini
 * @param prompt      custom prompt for Gemini (optional)
 */
export async function transcribeAudioWithGemini(
  audioData: ArrayBuffer,
  mimeType: string,
  prompt = "You are part of the world's best dictation app, Sonic Flow. Transcribe the audio as accurately as possible. If you detect an enumerated list (e.g., 'item one, item two, item three' or 'firstly, secondly, thirdly'), please format it as a numbered list (e.g., 1. Item one 2. Item two 3. Item three). Remove filler words. Your vocabulary includes: Sandheep Rajkumar, Supabase, Groq.",
): Promise<{ text: string; timings: Record<string, number> }> {
  const workerUrl = "https://api.sonicflow.app/gemini";

  // API Key check is now done in the worker, not here.
  // if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing'); // Removed

  if (audioData.byteLength === 0) {
    console.error("[GeminiTranscriber-CFW]	Audio data (ArrayBuffer) is empty.");
    throw new Error("Audio data (ArrayBuffer) is empty.");
  }

  try {
    // Create a Blob from the ArrayBuffer.
    // The filename is not strictly necessary for the worker, but providing one (e.g., based on mimeType) is fine.
    const filename = `audio.${mimeType.split("/")[1] || "bin"}`;
    const audioBlob = new Blob([audioData], { type: mimeType });

    const formData = new FormData();
    formData.append("audio", audioBlob, filename);
    formData.append("mimeType", mimeType);
    formData.append("prompt", prompt); // Send the prompt to the worker

    console.log(
      `[GeminiTranscriber-CFW]	Sending audio (${audioData.byteLength} bytes, type: ${mimeType}) to CF Worker: ${workerUrl}`,
    );

    const main_helper_fetch_start_time = performance.now();
    const response = await fetch(workerUrl, {
      method: "POST",
      body: formData,
    });
    const main_helper_fetch_end_time = performance.now();
    const main_fetch_gross_duration =
      main_helper_fetch_end_time - main_helper_fetch_start_time;

    console.log(
      `[GeminiTranscriber-CFW]	CF Worker call completed in ${main_fetch_gross_duration.toFixed(2)} ms (gross duration).`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[GeminiTranscriber-CFW]	Error from CF Worker: ${response.status} - ${errorText}`,
      );
      // Ensure the error thrown matches the expected structure if specific error handling is in place upstream
      throw new Error(
        `Gemini transcription failed via CF Worker: ${response.status} - ${errorText}`,
      );
    }

    const workerJsonResponse = await response.json();

    if (!workerJsonResponse || typeof workerJsonResponse.text !== "string") {
      console.error(
        "[GeminiTranscriber-CFW]	Unexpected response format from CF Worker (text missing):",
        workerJsonResponse,
      );
      throw new Error(
        "Unexpected response format from Gemini service via CF Worker (text missing).",
      );
    }

    const workerReportedTimings = workerJsonResponse.timings || {};
    const workerTotalDuration = workerReportedTimings.worker_total || 0;

    const edgeOverhead = Math.max(
      0,
      main_fetch_gross_duration - workerTotalDuration,
    );

    const finalTimingsToReturn: Record<string, number> = {
      edge_overhead: edgeOverhead,
    };

    for (const [key, value] of Object.entries(workerReportedTimings)) {
      if (typeof value === "number") {
        finalTimingsToReturn[`worker_${key}`] = value;
      }
    }

    console.log(
      "[GeminiTranscriber-CFW] Processed timings. edge_overhead:",
      edgeOverhead,
      "finalTimingsToReturn:",
      finalTimingsToReturn,
    );
    return {
      text: workerJsonResponse.text.trim(),
      timings: finalTimingsToReturn,
    };
  } catch (err: unknown) {
    console.error(
      "[GeminiTranscriber-CFW]	Error during transcription via CF Worker:",
      (err as Error)?.message || err,
    );
    // Propagate the error; specific error construction can be done here if needed
    throw err;
  }
}
