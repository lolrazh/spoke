// import Groq from 'groq-sdk'; // No longer using SDK directly
// Removed unused Blob import

// Import the required constant from config
import { TARGET_SAMPLE_RATE } from "../config/audio";
// For performance.now() in Node.js environment
import { performance } from "node:perf_hooks";
import { encodeWAV } from "../utils/wav";
import got, { HTTPAlias } from "got";
import FormData from "form-data";

// API key is no longer handled here; it's in the Cloudflare worker environment.
// Logging for API key status can be removed.

export interface GotTimingPhases {
  wait?: number;
  dns?: number;
  tcp?: number;
  tls?: number;
  request?: number;
  firstByte?: number;
  download?: number;
  total?: number;
}
export interface TimingInfo {
  client_phases: GotTimingPhases;
  client_protocol?: HTTPAlias;
  server_rewrite_ms?: number;
  server_request_body_read_ms?: number;
  server_upstream_ttfb_ms?: number;
  server_upstream_body_download_ms?: number;
  server_worker_total_ms?: number;
  edge_protocol?: string;
}

/**
 * Transcribes audio by sending it to a Cloudflare worker, which then calls the Groq API.
 * @param audioData The audio data as an ArrayBuffer.
 * @param inputLanguage The language of the audio (e.g., "en").
 * @returns Promise that resolves with the transcription text and detailed timings.
 */
export async function transcribeAudioWithGroq(
  audioData: ArrayBuffer,
  inputLanguage = "en"
): Promise<{ text: string; timings: TimingInfo }> {
  const workerUrl =
    "https://api.sonicflow.app/groq/openai/v1/audio/transcriptions";

  try {
    if (audioData.byteLength === 0) {
      console.error("[GroqTranscriber] Audio data is empty.");
      throw new Error("Audio data is empty.");
    }

    const wavBuf = encodeWAV(new Float32Array(audioData), TARGET_SAMPLE_RATE);

    const form = new FormData();
    form.append("file", wavBuf, {
      filename: "audio.wav",
      contentType: "audio/wav",
    });
    form.append("model", "distil-whisper-large-v3-en");
    form.append("language", inputLanguage);
    form.append("response_format", "json");
    form.append("temperature", "0.0");

    const response = await got.post(workerUrl, {
      body: form,
      http2: true,
      timings: true,
      throwHttpErrors: false, // We'll handle HTTP errors manually
    });

    console.log(
      `[GroqTranscriber] API call completed in ${response.timings.phases.total.toFixed(
        2
      )} ms.`
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.error(
        `[GroqTranscriber] Error from API: ${response.statusCode} - ${response.body}`
      );
      throw new Error(
        `Transcription failed: ${response.statusCode} - ${response.body}`
      );
    }

    const result = JSON.parse(response.body);
    const timings: TimingInfo = {
      client_phases: response.timings.phases,
      client_protocol: response.httpVersion,
      edge_protocol: response.headers["cf-edge-proto"] as string | undefined,
    };

    const serverTimingHeader = response.headers["server-timing"];
    if (typeof serverTimingHeader === "string") {
      serverTimingHeader.split(",").forEach((metric) => {
        const parts = metric.trim().split(";");
        const name = parts[0];
        const durPart = parts.find((p) => p.startsWith("dur="));
        if (durPart) {
          const duration = parseFloat(durPart.split("=")[1]);
          switch (name) {
            case "rewrite":
              timings.server_rewrite_ms = duration;
              break;
            case "request-body-read":
              timings.server_request_body_read_ms = duration;
              break;
            case "upstream-ttfb":
              timings.server_upstream_ttfb_ms = duration;
              break;
            case "upstream-body-download":
              timings.server_upstream_body_download_ms = duration;
              break;
            case "worker-total":
              timings.server_worker_total_ms = duration;
              break;
          }
        }
      });
    }

    if (!result || typeof result.text !== "string") {
      console.error(
        "[GroqTranscriber] Unexpected response format from API (text missing):",
        result
      );
      throw new Error(
        "Unexpected response format from transcription service."
      );
    }

    return { text: result.text, timings };
  } catch (error) {
    console.error("[GroqTranscriber] Error during transcription:", error);
    if (error instanceof Error && error.message.includes("fetch")) {
      throw new Error(`Network error during transcription: ${error.message}`);
    }
    throw error;
  }
}

// Removed createFileObject, initializeTempDir, and cleanupAllTempAudioFiles as they are no longer needed.
