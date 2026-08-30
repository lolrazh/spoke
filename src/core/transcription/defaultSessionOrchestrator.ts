import type { TranscriptionProvider } from "./providerContracts";
import { createSessionOrchestrator } from "./sessionOrchestrator";
import {
  LOCAL_STT_PROVIDER_ID,
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  DEEPGRAM_CLOUD_PROVIDER_ID,
  type PreferredTranscriptionProviderId,
} from "./providerPreferences";
import { localSttProvider } from "./providers/localSttProvider";

export {
  LOCAL_STT_PROVIDER_ID,
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  DEEPGRAM_CLOUD_PROVIDER_ID,
};

function createLazyCloudProvider(
  descriptor: TranscriptionProvider["descriptor"],
  load: () => Promise<TranscriptionProvider>,
): TranscriptionProvider {
  let providerPromise: Promise<TranscriptionProvider> | null = null;
  const loadProvider = () => (providerPromise ??= load());

  return {
    descriptor,
    getAvailability: async () => {
      const provider = await loadProvider();
      return (
        (await provider.getAvailability?.()) ?? {
          configured: false,
          available: false,
          reason: `${descriptor.displayName} provider is unavailable.`,
        }
      );
    },
    transcribe: (input) =>
      loadProvider().then((provider) => provider.transcribe(input)),
  };
}

const openAiCloudProvider = createLazyCloudProvider(
  {
    id: OPENAI_CLOUD_PROVIDER_ID,
    displayName: "OpenAI",
    kind: "cloud",
    requiresApiKey: true,
  },
  async () =>
    (await import("./providers/openAiCloudProvider")).openAiCloudProvider,
);

const groqCloudProvider = createLazyCloudProvider(
  {
    id: GROQ_CLOUD_PROVIDER_ID,
    displayName: "Groq",
    kind: "cloud",
    requiresApiKey: true,
  },
  async () =>
    (await import("./providers/groqCloudProvider")).groqCloudProvider,
);

const deepgramCloudProvider = createLazyCloudProvider(
  {
    id: DEEPGRAM_CLOUD_PROVIDER_ID,
    displayName: "Deepgram",
    kind: "cloud",
    requiresApiKey: true,
  },
  async () =>
    (await import("./providers/deepgramCloudProvider")).deepgramCloudProvider,
);

export const defaultTranscriptionSessionOrchestrator =
  createSessionOrchestrator({
    providers: [
      localSttProvider,
      openAiCloudProvider,
      groqCloudProvider,
      deepgramCloudProvider,
    ],
    defaultProviderId: LOCAL_STT_PROVIDER_ID,
  });

export function resolvePreferredTranscriptionProviderId(
  providerId?: PreferredTranscriptionProviderId | null,
) {
  return providerId ?? LOCAL_STT_PROVIDER_ID;
}
