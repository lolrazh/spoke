import type { TranscriptionProvider } from "../providerContracts";
import { OPENAI_CLOUD_PROVIDER_ID } from "../providerPreferences";
import { TranscriptionSessionError } from "../sessionErrors";

export const openAiCloudProvider: TranscriptionProvider = {
  descriptor: {
    id: OPENAI_CLOUD_PROVIDER_ID,
    displayName: "OpenAI Direct",
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
          : "Save an OpenAI API key to use OpenAI Direct.",
    };
  },
  transcribe: async ({ audioBlob, context }) => {
    if (!audioBlob) {
      throw new TranscriptionSessionError(
        "transcription_failed",
        "OpenAI Direct requires an audio blob.",
        { recoverable: false },
      );
    }

    if (!window.stt?.transcribeApiKeyProvider) {
      throw new TranscriptionSessionError(
        "provider_unavailable",
        "OpenAI Direct bridge is unavailable.",
        { recoverable: false },
      );
    }

    return window.stt.transcribeApiKeyProvider(OPENAI_CLOUD_PROVIDER_ID, {
      audioBuffer: await audioBlob.arrayBuffer(),
      mimeType: audioBlob.type || "audio/webm",
      context,
    });
  },
};
