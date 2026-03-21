import { createSessionOrchestrator } from "./sessionOrchestrator";
import {
  LOCAL_STT_PROVIDER_ID,
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  DEEPGRAM_CLOUD_PROVIDER_ID,
  type PreferredTranscriptionProviderId,
} from "./providerPreferences";
import { localSttProvider } from "./providers/localSttProvider";
import { openAiCloudProvider } from "./providers/openAiCloudProvider";
import { groqCloudProvider } from "./providers/groqCloudProvider";
import { deepgramCloudProvider } from "./providers/deepgramCloudProvider";

export {
  LOCAL_STT_PROVIDER_ID,
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  DEEPGRAM_CLOUD_PROVIDER_ID,
};

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
