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
  GROQ_CLOUD_PROVIDER_ID,
  SPOKE_CLOUD_PROVIDER_ID,
} from "./providerPreferences";

describe("providerCatalog", () => {
  it("lists the current provider catalog", () => {
    expect(
      listTranscriptionProviderCatalog().map((provider) => provider.id),
    ).toEqual([
      SPOKE_CLOUD_PROVIDER_ID,
      LOCAL_STT_PROVIDER_ID,
      OPENAI_CLOUD_PROVIDER_ID,
      GROQ_CLOUD_PROVIDER_ID,
    ]);
  });

  it("builds a settings snapshot with api-key configuration state", () => {
    const snapshot = buildTranscriptionProviderSettingsSnapshot({
      preferredProviderId: SPOKE_CLOUD_PROVIDER_ID,
      configuredApiKeyProviderIds: [OPENAI_CLOUD_PROVIDER_ID],
    });

    expect(snapshot).toEqual({
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

  it("sets modelInstalled on the local provider entry", () => {
    const withModel = buildTranscriptionProviderSettingsSnapshot({
      preferredProviderId: SPOKE_CLOUD_PROVIDER_ID,
      localModelInstalled: true,
    });
    const localEntry = withModel.providers.find(
      (p) => p.id === LOCAL_STT_PROVIDER_ID,
    );
    expect(localEntry?.modelInstalled).toBe(true);

    const withoutModel = buildTranscriptionProviderSettingsSnapshot({
      preferredProviderId: SPOKE_CLOUD_PROVIDER_ID,
      localModelInstalled: false,
    });
    const localEntry2 = withoutModel.providers.find(
      (p) => p.id === LOCAL_STT_PROVIDER_ID,
    );
    expect(localEntry2?.modelInstalled).toBe(false);

    // Cloud providers should have modelInstalled undefined
    const cloudEntry = withModel.providers.find(
      (p) => p.id === SPOKE_CLOUD_PROVIDER_ID,
    );
    expect(cloudEntry?.modelInstalled).toBeUndefined();
  });

  it("defaults localModelInstalled to false when omitted", () => {
    const snapshot = buildTranscriptionProviderSettingsSnapshot({
      preferredProviderId: SPOKE_CLOUD_PROVIDER_ID,
    });
    const localEntry = snapshot.providers.find(
      (p) => p.id === LOCAL_STT_PROVIDER_ID,
    );
    expect(localEntry?.modelInstalled).toBe(false);
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
    expect(isSelectableTranscriptionProviderId(GROQ_CLOUD_PROVIDER_ID)).toBe(
      true,
    );
    expect(isApiKeyTranscriptionProviderId(OPENAI_CLOUD_PROVIDER_ID)).toBe(
      true,
    );
    expect(isApiKeyTranscriptionProviderId(GROQ_CLOUD_PROVIDER_ID)).toBe(true);
  });
});
