import type { TranscriptionProvider } from "../providerContracts";
import { DEEPGRAM_CLOUD_PROVIDER_ID } from "../providerPreferences";
import { TranscriptionSessionError } from "../sessionErrors";
import { encodeCloudTranscriptionAudio } from "./cloudAudioPayload";

export const deepgramCloudProvider: TranscriptionProvider = {
  descriptor: {
    id: DEEPGRAM_CLOUD_PROVIDER_ID,
    displayName: "Deepgram",
    kind: "cloud",
    requiresApiKey: true,
  },
  getAvailability: async () => {
    const snapshot = await window.stt?.getProviderSettings?.();
    const provider = snapshot?.providers.find(
      (entry) => entry.id === DEEPGRAM_CLOUD_PROVIDER_ID,
    );

    return {
      configured: provider?.apiKeyConfigured ?? false,
      available: provider?.apiKeyConfigured ?? false,
      reason:
        provider?.apiKeyConfigured === true
          ? undefined
          : "Save a Deepgram API key to use Deepgram.",
    };
  },
  transcribe: async ({ audio, context }) => {
    if (!audio) {
      throw new TranscriptionSessionError(
        "transcription_failed",
        "Deepgram requires captured audio input.",
        { recoverable: false },
      );
    }

    if (!window.stt?.transcribeApiKeyProvider) {
      throw new TranscriptionSessionError(
        "provider_unavailable",
        "Deepgram bridge is unavailable.",
        { recoverable: false },
      );
    }

    return window.stt.transcribeApiKeyProvider(DEEPGRAM_CLOUD_PROVIDER_ID, {
      ...encodeCloudTranscriptionAudio(audio),
      context,
    });
  },
};
