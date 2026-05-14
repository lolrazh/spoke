import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProviderSelection } from "./useProviderSelection";
import type { TranscriptionProviderSettingsSnapshot } from "../core/transcription/providerCatalog";

describe("useProviderSelection", () => {
  beforeEach(() => {
    // Reset to default mock
    (window as any).stt = {
      ...window.stt,
      getProviderSettings:
        async (): Promise<TranscriptionProviderSettingsSnapshot> => ({
          preferredProviderId: "local-stt",
          providers: [],
        }),
    };
  });

  it("does not fabricate provider entries when the bridge returns an empty list", async () => {
    const { result } = renderHook(() => useProviderSelection());

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("local-stt");
    });

    expect(result.current.providerEntries).toEqual([]);
    expect(result.current.selectableProviderEntries).toEqual([]);
  });

  it("loads provider settings from window.stt bridge", async () => {
    (window as any).stt.getProviderSettings =
      async (): Promise<TranscriptionProviderSettingsSnapshot> => ({
        preferredProviderId: "local-stt",
        providers: [
          {
            id: "local-stt",
            displayName: "Local STT",
            description: "Local transcription",
            kind: "local",
            selectable: true,
            requiresApiKey: false,
            status: "ready",
            apiKeyConfigured: false,
          },
          {
            id: "openai-cloud",
            displayName: "OpenAI",
            description: "OpenAI transcription",
            kind: "cloud",
            selectable: true,
            requiresApiKey: true,
            status: "ready",
            apiKeyConfigured: true,
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

  it("filters non-selectable providers from selectableProviderEntries", async () => {
    (window as any).stt.getProviderSettings =
      async (): Promise<TranscriptionProviderSettingsSnapshot> => ({
        preferredProviderId: "local-stt",
        providers: [
          {
            id: "local-stt",
            displayName: "Local STT",
            description: "Local transcription",
            kind: "local",
            selectable: true,
            requiresApiKey: false,
            status: "ready",
            apiKeyConfigured: false,
          },
          {
            id: "openai-cloud",
            displayName: "OpenAI",
            description: "OpenAI transcription",
            kind: "cloud",
            selectable: false,
            requiresApiKey: true,
            status: "ready",
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
    expect(result.current.selectableProviderEntries[0].id).toBe("local-stt");
  });
});
