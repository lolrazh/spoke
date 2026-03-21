import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProviderSelection } from "./useProviderSelection";

describe("useProviderSelection", () => {
  beforeEach(() => {
    // Reset to default mock
    (window as any).stt = {
      ...window.stt,
      getProviderSettings: async () => ({
        preferredProviderId: "spoke-cloud",
        providers: [],
      }),
    };
  });

  it("returns spoke-cloud as default provider when providers list is empty", async () => {
    const { result } = renderHook(() => useProviderSelection());

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("spoke-cloud");
    });

    // Should still produce selectable entries from the fallback catalog
    expect(result.current.providerEntries.length).toBeGreaterThan(0);
  });

  it("loads provider settings from window.stt bridge", async () => {
    (window as any).stt.getProviderSettings = async () => ({
      preferredProviderId: "local-stt",
      providers: [
        {
          id: "local-stt",
          displayName: "Local STT",
          kind: "local",
          selectable: true,
          requiresApiKey: false,
          apiKeyConfigured: false,
        },
        {
          id: "spoke-cloud",
          displayName: "Spoke Cloud",
          kind: "cloud",
          selectable: true,
          requiresApiKey: false,
          apiKeyConfigured: false,
        },
      ],
    });

    const { result } = renderHook(() => useProviderSelection());

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("local-stt");
    });

    expect(result.current.selectableProviderEntries).toHaveLength(2);
    expect(result.current.selectedProviderEntry?.id).toBe("local-stt");
  });

  it("computes selectedProviderRequiresAuth correctly for local provider", async () => {
    (window as any).stt.getProviderSettings = async () => ({
      preferredProviderId: "local-stt",
      providers: [
        {
          id: "local-stt",
          displayName: "Local STT",
          kind: "local",
          selectable: true,
          requiresApiKey: false,
          apiKeyConfigured: false,
        },
      ],
    });

    const { result } = renderHook(() => useProviderSelection());

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("local-stt");
    });

    // Local provider should not require auth
    expect(result.current.selectedProviderRequiresAuth).toBe(false);
  });

  it("filters non-selectable providers from selectableProviderEntries", async () => {
    (window as any).stt.getProviderSettings = async () => ({
      preferredProviderId: "spoke-cloud",
      providers: [
        {
          id: "spoke-cloud",
          displayName: "Spoke Cloud",
          kind: "cloud",
          selectable: true,
          requiresApiKey: false,
          apiKeyConfigured: false,
        },
        {
          id: "openai-cloud",
          displayName: "OpenAI Direct",
          kind: "cloud",
          selectable: false,
          requiresApiKey: true,
          apiKeyConfigured: false,
        },
      ],
    });

    const { result } = renderHook(() => useProviderSelection());

    await waitFor(() => {
      expect(result.current.providerEntries).toHaveLength(2);
    });

    // Only selectable ones
    expect(result.current.selectableProviderEntries).toHaveLength(1);
    expect(result.current.selectableProviderEntries[0].id).toBe("spoke-cloud");
  });
});
