import type { PreferredTranscriptionProviderId } from "./providerPreferences";
import {
  LEGACY_CLOUD_PROVIDER_ID,
  LOCAL_STT_PROVIDER_ID,
} from "./providerPreferences";

export const OPENAI_CLOUD_PROVIDER_ID = "openai-cloud";

export type ApiKeyTranscriptionProviderId = typeof OPENAI_CLOUD_PROVIDER_ID;

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
}

export interface TranscriptionProviderSettingsSnapshot {
  preferredProviderId: PreferredTranscriptionProviderId;
  providers: TranscriptionProviderSettingsEntry[];
}

const TRANSCRIPTION_PROVIDER_CATALOG: TranscriptionProviderCatalogEntry[] = [
  {
    id: LEGACY_CLOUD_PROVIDER_ID,
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
    description: "On-device transcription through the bundled Moonshine sidecar.",
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
    selectable: false,
    requiresApiKey: true,
    status: "coming_soon",
    apiKeyLabel: "OpenAI API Key",
    apiKeyPlaceholder: "sk-...",
  },
];

export function listTranscriptionProviderCatalog(): TranscriptionProviderCatalogEntry[] {
  return [...TRANSCRIPTION_PROVIDER_CATALOG];
}

export function buildTranscriptionProviderSettingsSnapshot(input: {
  preferredProviderId: PreferredTranscriptionProviderId;
  configuredApiKeyProviderIds?: ApiKeyTranscriptionProviderId[];
}): TranscriptionProviderSettingsSnapshot {
  const configuredProviderIds = new Set(input.configuredApiKeyProviderIds ?? []);

  return {
    preferredProviderId: input.preferredProviderId,
    providers: TRANSCRIPTION_PROVIDER_CATALOG.map((provider) => ({
      ...provider,
      apiKeyConfigured:
        provider.requiresApiKey && configuredProviderIds.has(provider.id),
    })),
  };
}

export function isSelectableTranscriptionProviderId(
  providerId: string,
): providerId is PreferredTranscriptionProviderId {
  return (
    providerId === LOCAL_STT_PROVIDER_ID ||
    providerId === LEGACY_CLOUD_PROVIDER_ID
  );
}

export function isApiKeyTranscriptionProviderId(
  providerId: string,
): providerId is ApiKeyTranscriptionProviderId {
  return providerId === OPENAI_CLOUD_PROVIDER_ID;
}
