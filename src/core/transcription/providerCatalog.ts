import type { PreferredTranscriptionProviderId } from "./providerPreferences";
import {
  LOCAL_STT_PROVIDER_ID,
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  DEEPGRAM_CLOUD_PROVIDER_ID,
} from "./providerPreferences";
export {
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  DEEPGRAM_CLOUD_PROVIDER_ID,
} from "./providerPreferences";

export type ApiKeyTranscriptionProviderId =
  | typeof OPENAI_CLOUD_PROVIDER_ID
  | typeof GROQ_CLOUD_PROVIDER_ID
  | typeof DEEPGRAM_CLOUD_PROVIDER_ID;

export type CatalogTranscriptionProviderId =
  | PreferredTranscriptionProviderId
  | ApiKeyTranscriptionProviderId;

export interface TranscriptionProviderCatalogEntry {
  id: CatalogTranscriptionProviderId;
  displayName: string;
  description: string;
  kind: "local" | "cloud";
  selectable: boolean;
  requiresApiKey: boolean;
  status: "ready" | "coming_soon";
  apiKeyPlaceholder?: string;
}

export interface TranscriptionProviderSettingsEntry
  extends TranscriptionProviderCatalogEntry {
  apiKeyConfigured: boolean;
  modelInstalled?: boolean;
}

export interface TranscriptionProviderSettingsSnapshot {
  preferredProviderId: PreferredTranscriptionProviderId;
  providers: TranscriptionProviderSettingsEntry[];
}

const TRANSCRIPTION_PROVIDER_CATALOG: TranscriptionProviderCatalogEntry[] = [
  {
    id: LOCAL_STT_PROVIDER_ID,
    displayName: "Local",
    description: "Offline transcription with the local Whisper model.",
    kind: "local",
    selectable: true,
    requiresApiKey: false,
    status: "ready",
  },
  {
    id: OPENAI_CLOUD_PROVIDER_ID,
    displayName: "OpenAI",
    description: "Cloud transcription with your OpenAI API key.",
    kind: "cloud",
    selectable: true,
    requiresApiKey: true,
    status: "ready",
    apiKeyPlaceholder: "sk-…",
  },
  {
    id: GROQ_CLOUD_PROVIDER_ID,
    displayName: "Groq",
    description: "Cloud transcription with your Groq API key.",
    kind: "cloud",
    selectable: true,
    requiresApiKey: true,
    status: "ready",
    apiKeyPlaceholder: "gsk_…",
  },
  {
    id: DEEPGRAM_CLOUD_PROVIDER_ID,
    displayName: "Deepgram",
    description: "Cloud transcription with your Deepgram API key.",
    kind: "cloud",
    selectable: true,
    requiresApiKey: true,
    status: "ready",
    apiKeyPlaceholder: "dg_…",
  },
];

export function buildTranscriptionProviderSettingsSnapshot(input: {
  preferredProviderId: PreferredTranscriptionProviderId;
  configuredApiKeyProviderIds?: ApiKeyTranscriptionProviderId[];
  localModelInstalled?: boolean;
}): TranscriptionProviderSettingsSnapshot {
  const configuredProviderIds = new Set(
    input.configuredApiKeyProviderIds ?? [],
  );

  return {
    preferredProviderId: input.preferredProviderId,
    providers: TRANSCRIPTION_PROVIDER_CATALOG.map((provider) => {
      const apiKeyConfigured =
        isApiKeyTranscriptionProviderId(provider.id) &&
        configuredProviderIds.has(provider.id);

      return {
        ...provider,
        selectable:
          provider.selectable && (!provider.requiresApiKey || apiKeyConfigured),
        apiKeyConfigured,
        modelInstalled:
          provider.id === LOCAL_STT_PROVIDER_ID
            ? (input.localModelInstalled ?? false)
            : undefined,
      };
    }),
  };
}

export function isSelectableTranscriptionProviderId(
  providerId: string,
): providerId is PreferredTranscriptionProviderId {
  return (
    providerId === LOCAL_STT_PROVIDER_ID ||
    providerId === OPENAI_CLOUD_PROVIDER_ID ||
    providerId === GROQ_CLOUD_PROVIDER_ID ||
    providerId === DEEPGRAM_CLOUD_PROVIDER_ID
  );
}

export function isApiKeyTranscriptionProviderId(
  providerId: string,
): providerId is ApiKeyTranscriptionProviderId {
  return (
    providerId === OPENAI_CLOUD_PROVIDER_ID ||
    providerId === GROQ_CLOUD_PROVIDER_ID ||
    providerId === DEEPGRAM_CLOUD_PROVIDER_ID
  );
}
