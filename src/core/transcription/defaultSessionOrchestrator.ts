import { createSessionOrchestrator } from "./sessionOrchestrator";
import {
  LOCAL_STT_PROVIDER_ID,
  SPOKE_CLOUD_PROVIDER_ID,
  type PreferredTranscriptionProviderId,
} from "./providerPreferences";
import { localSttProvider } from "./providers/localSttProvider";
import { spokeCloudProvider } from "./providers/spokeCloudProvider";

export { LOCAL_STT_PROVIDER_ID, SPOKE_CLOUD_PROVIDER_ID };

export const defaultTranscriptionSessionOrchestrator =
  createSessionOrchestrator({
    providers: [localSttProvider, spokeCloudProvider],
    defaultProviderId: SPOKE_CLOUD_PROVIDER_ID,
  });

export function resolvePreferredTranscriptionProviderId(
  providerId?: PreferredTranscriptionProviderId | null,
) {
  return providerId ?? SPOKE_CLOUD_PROVIDER_ID;
}
