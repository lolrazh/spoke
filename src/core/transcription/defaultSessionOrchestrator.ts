import { createSessionOrchestrator } from "./sessionOrchestrator";
import {
  LEGACY_CLOUD_PROVIDER_ID,
  legacyCloudProvider,
} from "./providers/legacyCloudProvider";
import {
  LOCAL_STT_PROVIDER_ID,
  localSttProvider,
} from "./providers/localSttProvider";

export { LEGACY_CLOUD_PROVIDER_ID, LOCAL_STT_PROVIDER_ID };

export const defaultTranscriptionSessionOrchestrator =
  createSessionOrchestrator({
    providers: [localSttProvider, legacyCloudProvider],
    defaultProviderId: LEGACY_CLOUD_PROVIDER_ID,
  });

export function resolvePreferredTranscriptionProviderId(localEnabled: boolean) {
  return localEnabled ? LOCAL_STT_PROVIDER_ID : LEGACY_CLOUD_PROVIDER_ID;
}
