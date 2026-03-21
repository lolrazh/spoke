export const LOCAL_STT_PROVIDER_ID = "local-stt";
export const SPOKE_CLOUD_PROVIDER_ID = "spoke-cloud";
export const OPENAI_CLOUD_PROVIDER_ID = "openai-cloud";
export const GROQ_CLOUD_PROVIDER_ID = "groq-cloud";

export type PreferredTranscriptionProviderId =
  | typeof LOCAL_STT_PROVIDER_ID
  | typeof SPOKE_CLOUD_PROVIDER_ID
  | typeof OPENAI_CLOUD_PROVIDER_ID
  | typeof GROQ_CLOUD_PROVIDER_ID;

export interface TranscriptionProviderPreferences {
  preferredProviderId: PreferredTranscriptionProviderId;
}

export function getDefaultProviderPreferences(): TranscriptionProviderPreferences {
  return {
    preferredProviderId: SPOKE_CLOUD_PROVIDER_ID,
  };
}

export function normalizeProviderPreferences(
  raw: unknown,
): TranscriptionProviderPreferences {
  if (raw && typeof raw === "object") {
    const prefs = raw as {
      preferredProviderId?: unknown;
    };

    if (prefs.preferredProviderId === LOCAL_STT_PROVIDER_ID) {
      return {
        preferredProviderId: LOCAL_STT_PROVIDER_ID,
      };
    }

    if (prefs.preferredProviderId === SPOKE_CLOUD_PROVIDER_ID) {
      return {
        preferredProviderId: SPOKE_CLOUD_PROVIDER_ID,
      };
    }

    if (prefs.preferredProviderId === OPENAI_CLOUD_PROVIDER_ID) {
      return {
        preferredProviderId: OPENAI_CLOUD_PROVIDER_ID,
      };
    }

    if (prefs.preferredProviderId === GROQ_CLOUD_PROVIDER_ID) {
      return {
        preferredProviderId: GROQ_CLOUD_PROVIDER_ID,
      };
    }
  }

  return getDefaultProviderPreferences();
}

export function isLocalProviderSelected(
  providerId: PreferredTranscriptionProviderId | string | null | undefined,
): boolean {
  return providerId === LOCAL_STT_PROVIDER_ID;
}
