import type { TranscriptionProvider } from "../providerContracts";
import { LOCAL_STT_PROVIDER_ID } from "../providerPreferences";
import { TranscriptionSessionError } from "../sessionErrors";

export const localSttProvider: TranscriptionProvider = {
  descriptor: {
    id: LOCAL_STT_PROVIDER_ID,
    displayName: "Local STT",
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

    const pcmBuffer = new ArrayBuffer(pcm16.byteLength);
    new Uint8Array(pcmBuffer).set(
      new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength),
    );

    return window.stt.transcribeLocal(pcmBuffer);
  },
};
