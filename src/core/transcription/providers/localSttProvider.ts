import type { TranscriptionProvider } from "../providerContracts";
import { LOCAL_STT_PROVIDER_ID } from "../providerPreferences";
import { TranscriptionSessionError } from "../sessionErrors";

export const localSttProvider: TranscriptionProvider = {
  descriptor: {
    id: LOCAL_STT_PROVIDER_ID,
    displayName: "Local Whisper",
    kind: "local",
    requiresApiKey: false,
  },
  getAvailability: () => {
    const available =
      typeof window !== "undefined" &&
      typeof window.stt?.transcribeLocal === "function";

    return {
      configured: available,
      available,
      reason: available ? undefined : "Local Whisper bridge is unavailable.",
    };
  },
  prepare: async () => {
    if (!window.stt?.getModelStatus) {
      throw new TranscriptionSessionError(
        "provider_unavailable",
        "Local model status is unavailable.",
        { recoverable: false },
      );
    }

    const status = await window.stt.getModelStatus();
    if (status.state === "ready") {
      return {};
    }

    const message =
      status.state === "downloading" || status.state === "installing"
        ? "Local model is still downloading. Try again when it finishes."
        : status.state === "broken"
          ? "Local model needs to be reinstalled from Models."
          : "Model unavailable. Open Settings to install.";

    throw new TranscriptionSessionError("model_not_installed", message, {
      details: { modelState: status.state },
    });
  },
  transcribe: async ({ audio, context }) => {
    if (!audio) {
      throw new TranscriptionSessionError(
        "transcription_failed",
        "Local transcription requires PCM16 audio input.",
        { recoverable: false },
      );
    }

    if (!window.stt?.transcribeLocal) {
      throw new TranscriptionSessionError(
        "provider_unavailable",
        "Local transcription bridge is unavailable.",
        { recoverable: false },
      );
    }

    // The trimmed VAD output is normally a tight, exact-length Int16Array
    // (trimPcm16 -> Int16Array.prototype.slice), so its backing ArrayBuffer can
    // be handed to the bridge as-is. Only copy into a fresh buffer when the
    // view is a partial window over a larger buffer (byteOffset/length differ).
    const { pcm16 } = audio;
    const isExact =
      pcm16.byteOffset === 0 &&
      pcm16.byteLength === pcm16.buffer.byteLength;
    // Captured PCM is always backed by a plain ArrayBuffer (never a
    // SharedArrayBuffer), so this cast is safe.
    const pcmBuffer = (isExact ? pcm16.buffer : pcm16.slice().buffer) as ArrayBuffer;

    return window.stt.transcribeLocal(pcmBuffer, context?.sttPrompt);
  },
};
