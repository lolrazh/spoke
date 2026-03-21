import type { TranscriptionProvider } from "../providerContracts";
import { GROQ_CLOUD_PROVIDER_ID } from "../providerPreferences";
import { TranscriptionSessionError } from "../sessionErrors";

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
  transcribe: async ({ audioBlob, context }) => {
    if (!audioBlob) {
      throw new TranscriptionSessionError(
        "transcription_failed",
        "Groq requires an audio blob.",
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
      audioBuffer: await audioBlob.arrayBuffer(),
      mimeType: audioBlob.type || "audio/webm",
      context,
    });
  },
};
