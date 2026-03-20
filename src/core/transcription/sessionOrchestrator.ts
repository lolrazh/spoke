import type {
  TranscriptionProvider,
  TranscriptionProviderDescriptor,
} from "./providerContracts";
import { TranscriptionSessionError } from "./sessionErrors";
import type {
  PrepareTranscriptionInput,
  PrepareTranscriptionResult,
  TranscribeAudioInput,
  TranscriptionResult,
} from "./sessionTypes";

export interface TranscriptionSessionOrchestrator {
  defaultProviderId: string;
  listProviders: () => TranscriptionProviderDescriptor[];
  resolveProvider: (providerId?: string) => TranscriptionProvider;
  prepare: (
    providerId: string | undefined,
    input: PrepareTranscriptionInput,
  ) => Promise<PrepareTranscriptionResult | null>;
  transcribe: (
    providerId: string | undefined,
    input: TranscribeAudioInput,
  ) => Promise<TranscriptionResult>;
}

export interface CreateSessionOrchestratorOptions {
  providers: TranscriptionProvider[];
  defaultProviderId?: string;
}

export function createSessionOrchestrator(
  options: CreateSessionOrchestratorOptions,
): TranscriptionSessionOrchestrator {
  const providers = [...options.providers];

  if (providers.length === 0) {
    throw new TranscriptionSessionError(
      "provider_not_configured",
      "No transcription providers registered.",
      { recoverable: false },
    );
  }

  const providerById = new Map(
    providers.map((provider) => [provider.descriptor.id, provider]),
  );
  const defaultProviderId =
    options.defaultProviderId ?? providers[0].descriptor.id;

  const resolveProvider = (providerId = defaultProviderId) => {
    const provider = providerById.get(providerId);
    if (!provider) {
      throw new TranscriptionSessionError(
        "provider_not_configured",
        `Transcription provider '${providerId}' is not registered.`,
        { details: { providerId } },
      );
    }
    return provider;
  };

  return {
    defaultProviderId,
    listProviders: () => providers.map((provider) => provider.descriptor),
    resolveProvider,
    prepare: async (providerId, input) => {
      const provider = resolveProvider(providerId);
      if (!provider.prepare) {
        return null;
      }
      return provider.prepare(input);
    },
    transcribe: (providerId, input) =>
      resolveProvider(providerId).transcribe(input),
  };
}
