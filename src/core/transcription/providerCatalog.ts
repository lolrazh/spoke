import type { PreferredTranscriptionProviderId } from "./providerPreferences";
import {
  LOCAL_STT_PROVIDER_ID,
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  SPOKE_CLOUD_PROVIDER_ID,
} from "./providerPreferences";
export {
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
} from "./providerPreferences";

export type ApiKeyTranscriptionProviderId =
  | typeof OPENAI_CLOUD_PROVIDER_ID
  | typeof GROQ_CLOUD_PROVIDER_ID;

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
  apiKeyLabel?: string;
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
    id: SPOKE_CLOUD_PROVIDER_ID,
    displayName: "Spoke Cloud",
    description: "Hosted transcription through the existing Spoke backend.",
    kind: "cloud",
    selectable: true,
    requiresApiKey: false,
    status: "ready",
  },
  {
    id: LOCAL_STT_PROVIDER_ID,
    displayName: "Local Moonshine",
    description:
      "On-device transcription through the bundled Moonshine sidecar.",
    kind: "local",
    selectable: true,
    requiresApiKey: false,
    status: "ready",
  },
  {
    id: OPENAI_CLOUD_PROVIDER_ID,
    displayName: "OpenAI Direct",
    description: "Direct cloud transcription with your own OpenAI API key.",
    kind: "cloud",
    selectable: true,
    requiresApiKey: true,
    status: "ready",
    apiKeyLabel: "OpenAI API Key",
    apiKeyPlaceholder: "sk-...",
  },
  {
    id: GROQ_CLOUD_PROVIDER_ID,
    displayName: "Groq",
    description: "Fast cloud transcription with your own Groq API key.",
    kind: "cloud",
    selectable: true,
    requiresApiKey: true,
    status: "ready",
    apiKeyLabel: "Groq API Key",
    apiKeyPlaceholder: "gsk_...",
  },
];

export function listTranscriptionProviderCatalog(): TranscriptionProviderCatalogEntry[] {
  return [...TRANSCRIPTION_PROVIDER_CATALOG];
}

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
    providers: TRANSCRIPTION_PROVIDER_CATALOG.map((provider) => ({
      ...provider,
      selectable:
        provider.selectable &&
        (!provider.requiresApiKey || configuredProviderIds.has(provider.id)),
      apiKeyConfigured:
        provider.requiresApiKey && configuredProviderIds.has(provider.id),
      modelInstalled:
        provider.id === LOCAL_STT_PROVIDER_ID
          ? (input.localModelInstalled ?? false)
          : undefined,
    })),
  };
}

export function isSelectableTranscriptionProviderId(
  providerId: string,
): providerId is PreferredTranscriptionProviderId {
  return (
    providerId === LOCAL_STT_PROVIDER_ID ||
    providerId === SPOKE_CLOUD_PROVIDER_ID ||
    providerId === OPENAI_CLOUD_PROVIDER_ID ||
    providerId === GROQ_CLOUD_PROVIDER_ID
  );
}

export function isApiKeyTranscriptionProviderId(
  providerId: string,
): providerId is ApiKeyTranscriptionProviderId {
  return (
    providerId === OPENAI_CLOUD_PROVIDER_ID ||
    providerId === GROQ_CLOUD_PROVIDER_ID
  );
}
