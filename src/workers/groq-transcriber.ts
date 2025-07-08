// import Groq from 'groq-sdk'; // No longer using SDK directly
// Removed unused Blob import

// Import the required constant from config
import { TARGET_SAMPLE_RATE } from "../config/audio";
// For performance.now() in Node.js environment
import { performance } from "node:perf_hooks";
import https from "https";
import { encodeWAV } from "../utils/wav";
import got, { HTTPAlias } from "got";
import FormData from "form-data";
import { PassThrough } from "stream";

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
  client_protocol?: string;
  server_rewrite_ms?: number;
  server_request_body_read_ms?: number;
  server_upstream_ttfb_ms?: number;
  server_upstream_body_download_ms?: number;
  server_worker_total_ms?: number;
  edge_protocol?: string;
}

const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
});

export async function warmUpGroqConnection(): Promise<void> {
  const workerUrl =
    "https://api.sonicflow.app/groq/openai/v1/audio/transcriptions";
  try {
    console.log("[GroqTranscriber] Warming up connection...");
    await got.head(workerUrl, {
      agent: { https: keepAliveAgent },
      http2: true,
    });
    console.log("[GroqTranscriber] Connection warmed up successfully.");
  } catch (error) {
    console.error("[GroqTranscriber] Error warming up connection:", error);
  }
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

    const nodeBuffer = Buffer.from(audioData);
    const passThrough = new PassThrough();

    const boundary = `----WebKitFormBoundary${Math.random().toString(16).slice(2)}`;
    const contentType = `multipart/form-data; boundary=${boundary}`;

    passThrough.write(`--${boundary}\r\n`);
    passThrough.write('Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n');
    passThrough.write('Content-Type: audio/wav\r\n\r\n');
    passThrough.write(nodeBuffer);
    passThrough.write('\r\n');

    passThrough.write(`--${boundary}\r\n`);
    passThrough.write('Content-Disposition: form-data; name="model"\r\n\r\n');
    passThrough.write('distil-whisper-large-v3-en\r\n');

    passThrough.write(`--${boundary}\r\n`);
    passThrough.write('Content-Disposition: form-data; name="language"\r\n\r\n');
    passThrough.write(`${inputLanguage}\r\n`);

    passThrough.write(`--${boundary}\r\n`);
    passThrough.write('Content-Disposition: form-data; name="response_format"\r\n\r\n');
    passThrough.write('json\r\n');

    passThrough.write(`--${boundary}\r\n`);
    passThrough.write('Content-Disposition: form-data; name="temperature"\r\n\r\n');
    passThrough.write('0.0\r\n');

    passThrough.write(`--${boundary}--\r\n`);
    passThrough.end();

    let timings: TimingInfo = { client_phases: {} };

    const promise = new Promise<import("got").Response<string>>(
      (resolve, reject) => {
        const req = got.post(workerUrl, {
          body: passThrough,
          headers: {
            'Content-Type': contentType,
          },
          agent: {
            https: keepAliveAgent,
          },
          http2: true,
          throwHttpErrors: false,
        });

        req.on("response", (response) => {
          timings.client_phases = response.timings.phases;
          timings.client_protocol = response.httpVersion;
          timings.edge_protocol = response.headers["cf-edge-proto"] as
            | string
            | undefined;

          const serverTimingHeader = response.headers["server-timing"];
          if (typeof serverTimingHeader === "string") {
            serverTimingHeader.split(",").forEach((metric) => {
              const parts = metric.trim().split(";");
              const name = parts[0];
              const durPart = parts.find((p) => p.startsWith("dur="));
              if (durPart) {
                const value = durPart.split("=")[1];
                if (value) {
                  const duration = parseFloat(value);
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
              }
            });
          }
        });

        req.then(
          (response) => resolve(response as import("got").Response<string>),
          reject
        );
      }
    );

    const response = await promise;

    console.log(
      `[GroqTranscriber] API call completed in ${
        timings.client_phases.total?.toFixed(2) ?? "N/A"
      } ms.`
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
