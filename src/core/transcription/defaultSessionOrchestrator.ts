import { createSessionOrchestrator } from "./sessionOrchestrator";
import { localSttProvider } from "./providers/localSttProvider";

export const defaultTranscriptionSessionOrchestrator =
  createSessionOrchestrator({ providers: [localSttProvider] });
