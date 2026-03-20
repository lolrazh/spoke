import { createSessionOrchestrator } from "./sessionOrchestrator";
import {
  LEGACY_CLOUD_PROVIDER_ID,
  LOCAL_STT_PROVIDER_ID,
  type PreferredTranscriptionProviderId,
} from "./providerPreferences";
import { legacyCloudProvider } from "./providers/legacyCloudProvider";
import { localSttProvider } from "./providers/localSttProvider";

export { LEGACY_CLOUD_PROVIDER_ID, LOCAL_STT_PROVIDER_ID };

export const defaultTranscriptionSessionOrchestrator =
  createSessionOrchestrator({
    providers: [localSttProvider, legacyCloudProvider],
    defaultProviderId: LEGACY_CLOUD_PROVIDER_ID,
  });

export function resolvePreferredTranscriptionProviderId(
  providerId?: PreferredTranscriptionProviderId | null,
) {
  return providerId ?? LEGACY_CLOUD_PROVIDER_ID;
}
