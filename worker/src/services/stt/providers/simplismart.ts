export type SimplismartTranscriptionTimings = {
  startAt: number;
  headersAt: number;
  bodyDoneAt: number;
};

export type SimplismartTranscriptionResult = {
  text: string;
  timings: SimplismartTranscriptionTimings;
};

import {
  SIMPLISMART_STT_ENDPOINT,
  SIMPLISMART_STT_TURBO_ENDPOINT,
  SIMPLISMART_STT_TURBO_MODEL,
  STT_DEFAULT_MODEL,
  STT_DEFAULT_LANGUAGE,
  STT_DEFAULT_TIMEOUT_MS,
} from "../../../config";
import { DEFAULT_STT_PROMPT } from "../prompt";

export async function transcribeWav(
  wav: Uint8Array,
  apiKey: string,
  opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    language?: string;
    prompt?: string;
    model?: string;
  },
): Promise<SimplismartTranscriptionResult> {
  const startAt = Date.now();
  const timeoutMs = opts?.timeoutMs ?? STT_DEFAULT_TIMEOUT_MS;
  const language = opts?.language ?? STT_DEFAULT_LANGUAGE;
  const prompt = opts?.prompt ?? DEFAULT_STT_PROMPT;
  const model = opts?.model;

  // Select endpoint based on model (turbo uses different endpoint)
  const endpoint =
    model === SIMPLISMART_STT_TURBO_MODEL
      ? SIMPLISMART_STT_TURBO_ENDPOINT
      : SIMPLISMART_STT_ENDPOINT;

  // Convert WAV audio to base64 (process in chunks to avoid stack overflow)
  const base64EncodeStart = Date.now();
  const chunkSize = 8192;
  let binaryString = "";
  for (let i = 0; i < wav.length; i += chunkSize) {
    const chunk = wav.subarray(i, Math.min(i + chunkSize, wav.length));
    binaryString += String.fromCharCode(...chunk);
  }
  const base64Audio = btoa(binaryString);
  const base64EncodeMs = Date.now() - base64EncodeStart;

  // Build request body following Simplismart API format
  const requestBody = {
    audio_data: base64Audio,
    language: language,
    task: "transcribe" as const,
    word_timestamps: false,
    diarization: false,
    vad_filter: true,
    batch_size: 24,
    length_penalty: 1,
    vad_onset: 0.5,
    vad_offset: 0.363,
    beam_size: 5,
    initial_prompt: prompt || undefined,
  };

  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort();
  };
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onExternalAbort);
  }

  try {
    // Detailed timing breakdown for network debugging
    const timingLog: Record<string, number> = {};

    // 1. Measure DNS + connection setup (first fetch to endpoint)
    const fetchStartAt = Date.now();
    timingLog.fetch_start = fetchStartAt;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const headersAt = Date.now();
    timingLog.headers_received = headersAt;

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Simplismart STT error: ${res.status} ${body}`);
    }

    const json = (await res.json()) as {
      transcription?: string[];
      request_time?: number;
      language?: string;
      segments?: any[];
    };
    const bodyDoneAt = Date.now();
    timingLog.body_done = bodyDoneAt;

    // Calculate granular timing breakdown
    const ttfb = headersAt - fetchStartAt; // Time to first byte (DNS, TCP, TLS, upload, server processing)
    const bodyRead = bodyDoneAt - headersAt; // Response body download + JSON parse
    const total = bodyDoneAt - fetchStartAt; // Total fetch time (excludes base64 encoding)

    // Base64 encoding overhead measurement
    const base64Size = base64Audio.length;
    const wavSize = wav.length;
    const compressionRatio = (wavSize / base64Size) * 100;

    // Log detailed breakdown for debugging production latency
    console.log(`[STT:Simplismart] Latency breakdown:`, {
      endpoint: endpoint.includes("au163kpw51") ? "turbo" : "standard",
      audio_size_kb: (wavSize / 1024).toFixed(2),
      base64_size_kb: (base64Size / 1024).toFixed(2),
      compression_ratio: compressionRatio.toFixed(1) + "%",
      timings: {
        base64_encode_ms: base64EncodeMs, // Worker CPU time for base64 encoding (separate from fetch)
        total_ms: total, // fetch() call duration (DNS + TCP + TLS + upload + server + download)
        ttfb_ms: ttfb, // Time until response headers received (network + server processing)
        body_read_ms: bodyRead, // Time to download response body + parse JSON
        // ttfb breakdown (not individually measurable via fetch API):
        // - DNS: 10-50ms cached, 100-500ms uncached
        // - TCP handshake: ~1 RTT to India (~200-300ms from US)
        // - TLS handshake: ~2 RTT (~400-600ms from US)
        // - Upload: depends on payload size (4MB base64 = ~100-300ms on slow uplink)
        // - Server: ttfb - (DNS + TCP + TLS + upload) ≈ server_reported_time_ms
      },
      // NOTE: Simplismart API returns request_time in SECONDS (e.g., 0.037 = 37ms)
      server_reported_time_ms: json.request_time != null ? json.request_time * 1000 : null,
      estimated_network_overhead_ms: ttfb - ((json.request_time ?? 0) * 1000), // DNS + TCP + TLS + Request send
    });

    // Join transcription array into single text
    const transcriptionText = Array.isArray(json?.transcription)
      ? json.transcription.join(" ")
      : "";

    return {
      text: transcriptionText,
      timings: { startAt, headersAt, bodyDoneAt },
    };
  } finally {
    clearTimeout(timeoutId);
    if (opts?.signal) opts.signal.removeEventListener("abort", onExternalAbort);
  }
}
