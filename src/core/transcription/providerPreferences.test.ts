import { describe, expect, it } from "vitest";
import {
  getDefaultProviderPreferences,
  isLocalProviderSelected,
  LEGACY_CLOUD_PROVIDER_ID,
  LOCAL_STT_PROVIDER_ID,
  normalizeProviderPreferences,
} from "./providerPreferences";

describe("providerPreferences", () => {
  it("defaults to the legacy cloud provider", () => {
    expect(getDefaultProviderPreferences()).toEqual({
      preferredProviderId: LEGACY_CLOUD_PROVIDER_ID,
    });
  });

  it("normalizes new-format provider preferences", () => {
    expect(
      normalizeProviderPreferences({
        preferredProviderId: LOCAL_STT_PROVIDER_ID,
      }),
    ).toEqual({
      preferredProviderId: LOCAL_STT_PROVIDER_ID,
    });
  });

  it("migrates legacy localSttEnabled preferences", () => {
    expect(
      normalizeProviderPreferences({
        localSttEnabled: true,
      }),
    ).toEqual({
      preferredProviderId: LOCAL_STT_PROVIDER_ID,
    });
  });

  it("identifies whether the local provider is selected", () => {
    expect(isLocalProviderSelected(LOCAL_STT_PROVIDER_ID)).toBe(true);
    expect(isLocalProviderSelected(LEGACY_CLOUD_PROVIDER_ID)).toBe(false);
  });
});
