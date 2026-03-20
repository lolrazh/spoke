import { describe, expect, it } from "vitest";
import {
  buildTranscriptionProviderSettingsSnapshot,
  isApiKeyTranscriptionProviderId,
  isSelectableTranscriptionProviderId,
  listTranscriptionProviderCatalog,
} from "./providerCatalog";
import {
  LOCAL_STT_PROVIDER_ID,
  OPENAI_CLOUD_PROVIDER_ID,
  SPOKE_CLOUD_PROVIDER_ID,
} from "./providerPreferences";

describe("providerCatalog", () => {
  it("lists the current provider catalog", () => {
    expect(listTranscriptionProviderCatalog().map((provider) => provider.id)).toEqual([
      SPOKE_CLOUD_PROVIDER_ID,
      LOCAL_STT_PROVIDER_ID,
      OPENAI_CLOUD_PROVIDER_ID,
    ]);
  });

  it("builds a settings snapshot with api-key configuration state", () => {
    expect(
      buildTranscriptionProviderSettingsSnapshot({
        preferredProviderId: SPOKE_CLOUD_PROVIDER_ID,
        configuredApiKeyProviderIds: [OPENAI_CLOUD_PROVIDER_ID],
      }),
    ).toEqual({
      preferredProviderId: SPOKE_CLOUD_PROVIDER_ID,
      providers: expect.arrayContaining([
        expect.objectContaining({
          id: OPENAI_CLOUD_PROVIDER_ID,
          apiKeyConfigured: true,
          selectable: true,
          requiresApiKey: true,
        }),
      ]),
    });
  });

  it("checks selectable and api-key-backed provider ids", () => {
    expect(isSelectableTranscriptionProviderId(SPOKE_CLOUD_PROVIDER_ID)).toBe(
      true,
    );
    expect(isSelectableTranscriptionProviderId(LOCAL_STT_PROVIDER_ID)).toBe(
      true,
    );
    expect(isSelectableTranscriptionProviderId(OPENAI_CLOUD_PROVIDER_ID)).toBe(
      true,
    );
    expect(isApiKeyTranscriptionProviderId(OPENAI_CLOUD_PROVIDER_ID)).toBe(
      true,
    );
  });
});
