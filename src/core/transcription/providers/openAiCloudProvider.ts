import type { TranscriptionProvider } from "../providerContracts";
import { OPENAI_CLOUD_PROVIDER_ID } from "../providerPreferences";
import { TranscriptionSessionError } from "../sessionErrors";
import { encodeCloudTranscriptionAudio } from "./cloudAudioPayload";

export const openAiCloudProvider: TranscriptionProvider = {
  descriptor: {
    id: OPENAI_CLOUD_PROVIDER_ID,
    displayName: "OpenAI",
    kind: "cloud",
    requiresApiKey: true,
  },
  getAvailability: async () => {
    const snapshot = await window.stt?.getProviderSettings?.();
    const provider = snapshot?.providers.find(
      (entry) => entry.id === OPENAI_CLOUD_PROVIDER_ID,
    );

    return {
      configured: provider?.apiKeyConfigured ?? false,
      available: provider?.apiKeyConfigured ?? false,
      reason:
        provider?.apiKeyConfigured === true
          ? undefined
          : "Save an OpenAI API key to use OpenAI.",
    };
  },
  transcribe: async ({ audio, context }) => {
    if (!audio) {
      throw new TranscriptionSessionError(
        "transcription_failed",
        "OpenAI requires captured audio input.",
        { recoverable: false },
      );
    }

    if (!window.stt?.transcribeApiKeyProvider) {
      throw new TranscriptionSessionError(
        "provider_unavailable",
        "OpenAI bridge is unavailable.",
        { recoverable: false },
      );
    }

    return window.stt.transcribeApiKeyProvider(OPENAI_CLOUD_PROVIDER_ID, {
      ...encodeCloudTranscriptionAudio(audio),
      context,
    });
  },
};
