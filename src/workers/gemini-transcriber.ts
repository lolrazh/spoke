// gemini-transcriber.ts
// import { GoogleGenAI } from '@google/genai';        // npm i @google/genai

// API key is no longer handled here; it's in the Cloudflare worker environment.
// Logging for API key status can be removed from here.

// The arrayBufferToBase64 helper is also not needed here anymore, as the worker handles it.

import { performance } from "node:perf_hooks"; // ESM style import
import { Buffer } from "node:buffer";
import { encodeWAV } from "../utils/wav";
import { TARGET_SAMPLE_RATE } from "../config/audio";
import { timedFetch, TimingInfo } from "../utils/timed-fetch";

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
): Promise<{ text: string; timings: TimingInfo }> {
  // upstream Gemini endpoint lives under /gemini/…
  const workerUrl =
    "https://api.sonicflow.app/gemini/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent";

  // API Key check is now done in the worker, not here.
  // if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing'); // Removed

  if (audioData.byteLength === 0) {
    console.error("[GeminiTranscriber] Audio data (ArrayBuffer) is empty.");
    throw new Error("Audio data (ArrayBuffer) is empty.");
  }

  try {
    const main_helper_fetch_start_time = performance.now();

    // If caller already handed us a WAV, skip re-encoding.
    let wavBuffer: ArrayBuffer;
    if (mimeType === "audio/wav") {
      wavBuffer = audioData; // already WAV
    } else {
      if (audioData.byteLength % 4 !== 0) {
        throw new RangeError(
          "PCM ArrayBuffer length must be a multiple of 4 bytes",
        );
      }
      wavBuffer = encodeWAV(new Float32Array(audioData), TARGET_SAMPLE_RATE);
    }

    const b64 = Buffer.from(wavBuffer).toString("base64");

    const geminiJson = {
      contents: [
        { role: "user", parts: [{ text: prompt }] },
        {
          role: "user",
          parts: [{ inlineData: { mimeType: "audio/wav", data: b64 } }],
        },
      ],
    };

    console.log(
      `[GeminiTranscriber] Sending audio (${audioData.byteLength} bytes) to API.`,
    );

    const { response, timings } = await timedFetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiJson),
    });

    console.log(
      `[GeminiTranscriber] API call completed in ${timings.total_duration_ms.toFixed(
        2,
      )} ms.`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[GeminiTranscriber] Error from API: ${response.status} - ${errorText}`,
      );
      // Ensure the error thrown matches the expected structure if specific error handling is in place upstream
      throw new Error(
        `Gemini transcription failed: ${response.status} - ${errorText}`,
      );
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof text !== "string") {
      console.error(
        "[GeminiTranscriber] Unexpected response format from API (text missing):",
        result,
      );
      throw new Error(
        "Unexpected response format from Gemini service (text missing).",
      );
    }

    return {
      text: text.trim(),
      timings,
    };
  } catch (err: unknown) {
    console.error(
      "[GeminiTranscriber] Error during transcription:",
      (err as Error)?.message || err,
    );
    // Propagate the error; specific error construction can be done here if needed
    throw err;
  }
}
