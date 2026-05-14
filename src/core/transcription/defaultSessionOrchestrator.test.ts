import { describe, expect, it } from "vitest";
import {
  LOCAL_STT_PROVIDER_ID,
  resolvePreferredTranscriptionProviderId,
} from "./defaultSessionOrchestrator";

describe("defaultSessionOrchestrator", () => {
  it("defaults to the local provider when no preference is stored", () => {
    expect(resolvePreferredTranscriptionProviderId()).toBe(
      LOCAL_STT_PROVIDER_ID,
    );
  });
});
