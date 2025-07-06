// import Groq from 'groq-sdk'; // No longer using SDK directly
// Removed unused Blob import

// Import the required constant from config
import { TARGET_SAMPLE_RATE } from "../config/audio";
// For performance.now() in Node.js environment
import { performance } from "node:perf_hooks";
import { encodeWAV } from "../utils/wav";

// API key is no longer handled here; it's in the Cloudflare worker environment.
// Logging for API key status can be removed.

/**
 * Transcribes audio by sending it to a Cloudflare worker, which then calls the Groq API.
 * @param audioData The audio data as an ArrayBuffer.
 * @param inputLanguage The language of the audio (e.g., "en").
 * @returns Promise that resolves with the transcription text.
 */
export async function transcribeAudioWithGroq(
  audioData: ArrayBuffer,
  inputLanguage = "en",
): Promise<{ text: string; timings: Record<string, number> }> {
  // hit the new micro-proxy *including* the upstream Groq path
  const workerUrl =
    "https://api.sonicflow.app/groq/openai/v1/audio/transcriptions";

  try {
    if (audioData.byteLength === 0) {
      console.error("[GroqTranscriber] Audio data is empty.");
      throw new Error("Audio data is empty.");
    }

    const main_helper_fetch_start_time = performance.now();

    // ➊ convert PCM ➜ WAV locally
    const wavBuf = encodeWAV(new Float32Array(audioData), TARGET_SAMPLE_RATE);
    const wavBlob = new Blob([wavBuf], { type: "audio/wav" });

    // ➋ build Groq-style multipart form
    const form = new FormData();
    form.append("file", wavBlob, "audio.wav");
    form.append("model", "distil-whisper-large-v3-en");
    form.append("language", inputLanguage);
    form.append("response_format", "json");
    form.append("temperature", "0.0");

    const response = await fetch(workerUrl, { method: "POST", body: form });

    const main_helper_fetch_end_time = performance.now();
    const main_fetch_gross_duration =
      main_helper_fetch_end_time - main_helper_fetch_start_time;

    console.log(
      `[GroqTranscriber] API call completed in ${main_fetch_gross_duration.toFixed(2)} ms.`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[GroqTranscriber] Error from API: ${response.status} - ${errorText}`,
      );
      throw new Error(`Transcription failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (!result || typeof result.text !== "string") {
      console.error(
        "[GroqTranscriber] Unexpected response format from API (text missing):",
        result,
      );
      throw new Error(
        "Unexpected response format from transcription service.",
      );
    }

    return { text: result.text, timings: { total_duration: main_fetch_gross_duration } };
  } catch (error) {
    console.error(
      "[GroqTranscriber] Error during transcription:",
      error,
    );
    // To provide more context, we check if it's a FetchError or similar network issue
    if (error instanceof Error && error.message.includes("fetch")) {
      // Basic check for fetch related errors
      throw new Error(`Network error during transcription: ${error.message}`);
    }
    throw error; // Re-throw other errors
  }
}

// Removed createFileObject, initializeTempDir, and cleanupAllTempAudioFiles as they are no longer needed.
