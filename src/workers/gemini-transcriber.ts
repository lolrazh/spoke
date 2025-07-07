// gemini-transcriber.ts
// import { GoogleGenAI } from '@google/genai';        // npm i @google/genai

// API key is no longer handled here; it's in the Cloudflare worker environment.
// Logging for API key status can be removed from here.

// The arrayBufferToBase64 helper is also not needed here anymore, as the worker handles it.

import { performance } from "node:perf_hooks";
import { Buffer } from "node:buffer";
import { encodeWAV } from "../utils/wav";
import { TARGET_SAMPLE_RATE } from "../config/audio";
import got, { HTTPAlias } from "got";

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
  prompt = "You are part of the world's best dictation app, Sonic Flow. Transcribe the audio as accurately as possible. If you detect an enumerated list (e.g., 'item one, item two, item three' or 'firstly, secondly, thirdly'), please format it as a numbered list (e.g., 1. Item one 2. Item two 3. Item three). Remove filler words. Your vocabulary includes: Sandheep Rajkumar, Supabase, Groq."
): Promise<{ text: string; timings: TimingInfo }> {
  const workerUrl =
    "https://api.sonicflow.app/gemini/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent";

  if (audioData.byteLength === 0) {
    console.error("[GeminiTranscriber] Audio data (ArrayBuffer) is empty.");
    throw new Error("Audio data (ArrayBuffer) is empty.");
  }

  try {
    let wavBuffer: ArrayBuffer;
    if (mimeType === "audio/wav") {
      wavBuffer = audioData;
    } else {
      if (audioData.byteLength % 4 !== 0) {
        throw new RangeError(
          "PCM ArrayBuffer length must be a multiple of 4 bytes"
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

    let timings: TimingInfo = { client_phases: {} };

    const promise = new Promise<import("got").Response<string>>(
      (resolve, reject) => {
        const req = got.post(workerUrl, {
          json: geminiJson,
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
      `[GeminiTranscriber] API call completed in ${
        timings.client_phases.total?.toFixed(2) ?? "N/A"
      } ms.`
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const errorText = response.body;
      console.error(
        `[GeminiTranscriber] Error from API: ${response.statusCode} - ${errorText}`
      );
      throw new Error(
        `Gemini transcription failed: ${response.statusCode} - ${errorText}`
      );
    }

    const result = JSON.parse(response.body);
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof text !== "string") {
      console.error(
        "[GeminiTranscriber] Unexpected response format from API (text missing):",
        result
      );
      throw new Error(
        "Unexpected response format from Gemini service (text missing)."
      );
    }

    return {
      text: text.trim(),
      timings,
    };
  } catch (err: unknown) {
    console.error(
      "[GeminiTranscriber] Error during transcription:",
      (err as Error)?.message || err
    );
    throw err;
  }
}
