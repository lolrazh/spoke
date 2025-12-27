import {
  FIREWORKS_STT_TURBO_ENDPOINT,
  FIREWORKS_STT_DEFAULT_ALIGNMENT_MODEL,
  FIREWORKS_STT_DEFAULT_PREPROCESSING,
  FIREWORKS_STT_DEFAULT_TEMPERATURES,
  FIREWORKS_STT_DEFAULT_VAD_MODEL,
  STT_DEFAULT_LANGUAGE,
  STT_DEFAULT_MODEL,
  STT_DEFAULT_TIMEOUT_MS,
} from "../../../config";
import { DEFAULT_STT_PROMPT } from "../prompt";

type BasicTimings = {
  startAt: number;
  headersAt: number;
  bodyDoneAt: number;
};

export type FireworksTranscriptionResult = {
  text: string;
  timings: BasicTimings;
};

const FIREWORKS_HOSTNAME = new URL(FIREWORKS_STT_TURBO_ENDPOINT).hostname;

type TranscribeOpts = {
  timeoutMs?: number;
  signal?: AbortSignal;
  language?: string;
  prompt?: string;
  model?: string;
  preprocessing?: string;
  vadModel?: string;
  alignmentModel?: string;
  temperatureSchedule?: string;
};

export async function transcribeWav(
  wav: Uint8Array,
  apiKey: string,
  opts?: TranscribeOpts,
): Promise<FireworksTranscriptionResult> {
  const startAt = Date.now();
  const timeoutMs = opts?.timeoutMs ?? STT_DEFAULT_TIMEOUT_MS;
  const model = opts?.model ?? STT_DEFAULT_MODEL;
  const language = opts?.language ?? STT_DEFAULT_LANGUAGE;
  const prompt = opts?.prompt ?? DEFAULT_STT_PROMPT;
  const preprocessing =
    opts?.preprocessing ?? FIREWORKS_STT_DEFAULT_PREPROCESSING;
  const vadModel = opts?.vadModel ?? FIREWORKS_STT_DEFAULT_VAD_MODEL;
  const alignmentModel =
    opts?.alignmentModel ?? FIREWORKS_STT_DEFAULT_ALIGNMENT_MODEL;
  const temperatureSchedule =
    opts?.temperatureSchedule ?? FIREWORKS_STT_DEFAULT_TEMPERATURES;

  const endpoint = FIREWORKS_STT_TURBO_ENDPOINT;

  const form = new FormData();
  const file = new File([wav], "audio.wav", { type: "audio/wav" });
  form.append("file", file);
  form.append("model", model);
  form.append("language", language);
  form.append("prompt", prompt);
  form.append("preprocessing", preprocessing);
  form.append("vad_model", vadModel);
  form.append("alignment_model", alignmentModel);
  form.append("temperature", temperatureSchedule);

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onExternalAbort);
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: apiKey },
      body: form,
      signal: controller.signal,
    });
    const headersAt = Date.now();

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`FIREWORKS STT error: ${res.status} ${body}`);
    }

    const json = (await res.json()) as { text?: string };
    const bodyDoneAt = Date.now();

    return {
      text: json?.text ?? "",
      timings: { startAt, headersAt, bodyDoneAt },
    };
  } finally {
    clearTimeout(timeoutId);
    if (opts?.signal) opts.signal.removeEventListener("abort", onExternalAbort);
  }
}
