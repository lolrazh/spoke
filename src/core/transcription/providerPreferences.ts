export const LOCAL_STT_PROVIDER_ID = "local-stt";
export const LEGACY_CLOUD_PROVIDER_ID = "legacy-cloud";

export type PreferredTranscriptionProviderId =
  | typeof LOCAL_STT_PROVIDER_ID
  | typeof LEGACY_CLOUD_PROVIDER_ID;

export interface TranscriptionProviderPreferences {
  preferredProviderId: PreferredTranscriptionProviderId;
}

export function getDefaultProviderPreferences(): TranscriptionProviderPreferences {
  return {
    preferredProviderId: LEGACY_CLOUD_PROVIDER_ID,
  };
}

export function normalizeProviderPreferences(
  raw: unknown,
): TranscriptionProviderPreferences {
  if (raw && typeof raw === "object") {
    const prefs = raw as {
      preferredProviderId?: unknown;
      localSttEnabled?: unknown;
    };

    if (prefs.preferredProviderId === LOCAL_STT_PROVIDER_ID) {
      return {
        preferredProviderId: LOCAL_STT_PROVIDER_ID,
      };
    }

    if (prefs.preferredProviderId === LEGACY_CLOUD_PROVIDER_ID) {
      return {
        preferredProviderId: LEGACY_CLOUD_PROVIDER_ID,
      };
    }

    if (typeof prefs.localSttEnabled === "boolean") {
      return {
        preferredProviderId: prefs.localSttEnabled
          ? LOCAL_STT_PROVIDER_ID
          : LEGACY_CLOUD_PROVIDER_ID,
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
