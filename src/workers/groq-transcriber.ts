// import Groq from 'groq-sdk'; // No longer using SDK directly
// Removed unused Blob import

// Import the required constant from config
import { TARGET_SAMPLE_RATE } from "../config/audio";
// For performance.now() in Node.js environment
import { performance } from "node:perf_hooks";

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
  const workerUrl = "https://api.sonicflow.app/groq";

  try {
    if (audioData.byteLength === 0) {
      console.error("[GroqTranscriber-CFW]	Audio data (ArrayBuffer) is empty.");
      throw new Error("Audio data (ArrayBuffer) is empty.");
    }

    // Sending raw PCM Float32 ArrayBuffer directly
    console.log(
      `[GroqTranscriber-CFW]	Sending raw PCM F32 (${audioData.byteLength} bytes) to CF Worker: ${workerUrl}`,
    );

    const main_helper_fetch_start_time = performance.now();
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        // Indicate that the body is raw PCM data (Float32)
        "Content-Type": "audio/pcm",
        "X-Audio-Language": inputLanguage,
        "X-Sample-Rate": TARGET_SAMPLE_RATE.toString(), // Use centralized sample rate
        "X-Bit-Depth": "32", // Float32 is 32-bit
        "X-Channels": "1", // Mono audio
        // 'X-Audio-Filename' is not strictly needed if not using FormData on worker side for this path
      },
      body: audioData, // Send raw ArrayBuffer
    });
    const main_helper_fetch_end_time = performance.now();
    const main_fetch_gross_duration =
      main_helper_fetch_end_time - main_helper_fetch_start_time;

    console.log(
      `[GroqTranscriber-CFW]	CF Worker call completed in ${main_fetch_gross_duration.toFixed(2)} ms (gross duration).`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[GroqTranscriber-CFW]	Error from CF Worker: ${response.status} - ${errorText}`,
      );
      throw new Error(
        `Transcription failed: ${response.status} - ${errorText}`,
      );
    }

    const workerJsonResponse = await response.json();

    if (!workerJsonResponse || typeof workerJsonResponse.text !== "string") {
      console.error(
        "[GroqTranscriber-CFW]	Unexpected response format from CF Worker (text missing):",
        workerJsonResponse,
      );
      throw new Error(
        "Unexpected response format from transcription service via CF Worker (text missing).",
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
      "[GroqTranscriber-CFW] Processed timings. edge_overhead:",
      edgeOverhead,
      "finalTimingsToReturn:",
      finalTimingsToReturn,
    );
    return { text: workerJsonResponse.text, timings: finalTimingsToReturn };
  } catch (error) {
    console.error(
      "[GroqTranscriber-CFW]	Error during transcription via CF Worker:",
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
