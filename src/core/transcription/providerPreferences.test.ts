import { describe, expect, it } from "vitest";
import {
  getDefaultProviderPreferences,
  isLocalProviderSelected,
  LOCAL_STT_PROVIDER_ID,
  normalizeProviderPreferences,
  OPENAI_CLOUD_PROVIDER_ID,
  SPOKE_CLOUD_PROVIDER_ID,
} from "./providerPreferences";

describe("providerPreferences", () => {
  it("defaults to the local provider", () => {
    expect(getDefaultProviderPreferences()).toEqual({
      preferredProviderId: LOCAL_STT_PROVIDER_ID,
    });
  });

  it("normalizes new-format provider preferences", () => {
    expect(
      normalizeProviderPreferences({
        preferredProviderId: OPENAI_CLOUD_PROVIDER_ID,
      }),
    ).toEqual({
      preferredProviderId: OPENAI_CLOUD_PROVIDER_ID,
    });
  });

  it("identifies whether the local provider is selected", () => {
    expect(isLocalProviderSelected(LOCAL_STT_PROVIDER_ID)).toBe(true);
    expect(isLocalProviderSelected(SPOKE_CLOUD_PROVIDER_ID)).toBe(false);
  });
});
