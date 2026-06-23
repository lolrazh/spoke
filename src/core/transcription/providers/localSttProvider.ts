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
          : "Model unavailable. Open Models to install it.";

    throw new TranscriptionSessionError("model_not_installed", message, {
      details: { modelState: status.state },
    });
  },
  transcribe: async ({ audio }) => {
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

    const pcmBuffer = new ArrayBuffer(audio.pcm16.byteLength);
    new Uint8Array(pcmBuffer).set(
      new Uint8Array(
        audio.pcm16.buffer,
        audio.pcm16.byteOffset,
        audio.pcm16.byteLength,
      ),
    );

    return window.stt.transcribeLocal(pcmBuffer);
  },
};
