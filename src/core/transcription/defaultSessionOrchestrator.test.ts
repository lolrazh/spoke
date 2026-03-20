import { describe, expect, it } from "vitest";
import {
  LOCAL_STT_PROVIDER_ID,
  OPENAI_CLOUD_PROVIDER_ID,
  preferredTranscriptionProviderRequiresAuth,
  resolvePreferredTranscriptionProviderId,
  SPOKE_CLOUD_PROVIDER_ID,
} from "./defaultSessionOrchestrator";

describe("defaultSessionOrchestrator", () => {
  it("defaults to Spoke Cloud when no preference is stored", () => {
    expect(resolvePreferredTranscriptionProviderId()).toBe(
      SPOKE_CLOUD_PROVIDER_ID,
    );
  });

  it("reports auth requirements by provider", () => {
    expect(
      preferredTranscriptionProviderRequiresAuth(SPOKE_CLOUD_PROVIDER_ID),
    ).toBe(true);
    expect(
      preferredTranscriptionProviderRequiresAuth(LOCAL_STT_PROVIDER_ID),
    ).toBe(false);
    expect(
      preferredTranscriptionProviderRequiresAuth(OPENAI_CLOUD_PROVIDER_ID),
    ).toBe(false);
  });
});
