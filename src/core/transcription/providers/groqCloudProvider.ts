import type { TranscriptionProvider } from "../providerContracts";
import { GROQ_CLOUD_PROVIDER_ID } from "../providerPreferences";
import { TranscriptionSessionError } from "../sessionErrors";
import { encodeCloudTranscriptionAudio } from "./cloudAudioPayload";

export const groqCloudProvider: TranscriptionProvider = {
  descriptor: {
    id: GROQ_CLOUD_PROVIDER_ID,
    displayName: "Groq",
    kind: "cloud",
    requiresApiKey: true,
  },
  getAvailability: async () => {
    const snapshot = await window.stt?.getProviderSettings?.();
    const provider = snapshot?.providers.find(
      (entry) => entry.id === GROQ_CLOUD_PROVIDER_ID,
    );

    return {
      configured: provider?.apiKeyConfigured ?? false,
      available: provider?.apiKeyConfigured ?? false,
      reason:
        provider?.apiKeyConfigured === true
          ? undefined
          : "Save a Groq API key to use Groq.",
    };
  },
  transcribe: async ({ audio, context }) => {
    if (!audio) {
      throw new TranscriptionSessionError(
        "transcription_failed",
        "Groq requires captured audio input.",
        { recoverable: false },
      );
    }

    if (!window.stt?.transcribeApiKeyProvider) {
      throw new TranscriptionSessionError(
        "provider_unavailable",
        "Groq bridge is unavailable.",
        { recoverable: false },
      );
    }

    return window.stt.transcribeApiKeyProvider(GROQ_CLOUD_PROVIDER_ID, {
      ...encodeCloudTranscriptionAudio(audio),
      context,
    });
  },
};
