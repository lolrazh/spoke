import type { TranscriptionProvider } from "../providerContracts";
import { TranscriptionSessionError } from "../sessionErrors";

export const LOCAL_STT_PROVIDER_ID = "local-stt";

export const localSttProvider: TranscriptionProvider = {
  descriptor: {
    id: LOCAL_STT_PROVIDER_ID,
    displayName: "Local STT",
    kind: "local",
    requiresAuthToken: false,
    requiresApiKey: false,
  },
  getAvailability: () => {
    const available =
      typeof window !== "undefined" &&
      typeof window.stt?.transcribeLocal === "function";

    return {
      configured: available,
      available,
      reason: available ? undefined : "Local STT bridge is unavailable.",
    };
  },
  transcribe: async ({ pcm16 }) => {
    if (!pcm16) {
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

    const pcmBuffer = pcm16.buffer.slice(
      pcm16.byteOffset,
      pcm16.byteOffset + pcm16.byteLength,
    );

    return window.stt.transcribeLocal(pcmBuffer);
  },
};
