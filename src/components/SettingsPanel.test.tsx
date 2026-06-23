import React, { act } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { PermissionsProvider } from "../state/permissionsContext";
import { buildTranscriptionProviderSettingsSnapshot } from "../core/transcription/providerCatalog";
import { LOCAL_STT_PROVIDER_ID } from "../core/transcription/providerPreferences";

function render(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(PermissionsProvider, null, ui));
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("components/SettingsPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Ensure electron + mic bridges exist
    (window as any).electron = (window as any).electron || {
      getFloatingBarEnabled: async () => ({ enabled: true }),
      isFloatingBarVisible: async () => ({ visible: true }),
      checkPermissions: async () => ({
        needAX: false,
        needIM: false,
        isDev: true,
      }),
      checkMicrophonePermission: async () => ({
        status: "granted",
        granted: true,
      }),
      openSystemPreferences: async () => {},
    };
    (window as any).mic = {
      select: vi.fn(async (_id: string) => ({ ok: true })),
      getSelected: vi.fn(async () => ({ id: "default" })),
      onSelectedChanged: (cb: (p: { id: string }) => void) => () => {},
      onRefreshRequest: (_cb: () => void) => () => {},
      updateDevices: (_d: any, _s?: string) => {},
    } as any;
    const providerSettings = buildTranscriptionProviderSettingsSnapshot({
      preferredProviderId: LOCAL_STT_PROVIDER_ID,
      localModelInstalled: false,
    });
    (window as any).stt = {
      ...(window as any).stt,
      getProviderSettings: vi.fn(async () => providerSettings),
      setProviderApiKey: vi.fn(async () => providerSettings),
      clearProviderApiKey: vi.fn(async () => providerSettings),
    };
    // Media devices
    // @ts-ignore
    navigator.mediaDevices = {
      enumerateDevices: vi.fn(
        async () =>
          [
            { kind: "audioinput", deviceId: "mic1", label: "Mic 1" },
            { kind: "videoinput", deviceId: "cam", label: "Cam" },
            { kind: "audioinput", deviceId: "mic2", label: "Mic 2" },
          ] as any,
      ),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as any;
  });

  it("queries electron state and enumerates devices on mount", async () => {
    const SettingsPanel = (await import("./SettingsPanel")).default;
    const spyGetEnabled = vi.spyOn(window.electron, "getFloatingBarEnabled");

    const { unmount } = render(React.createElement(SettingsPanel));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(spyGetEnabled).toHaveBeenCalled();
    expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled();
    unmount();
  }, 10_000);

  it("initializes mic list and queries selected mic from main", async () => {
    const SettingsPanel = (await import("./SettingsPanel")).default;
    const { unmount } = render(React.createElement(SettingsPanel));
    await act(async () => {
      await Promise.resolve();
    });

    expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled();
    expect(window.mic.getSelected).toHaveBeenCalled();
    unmount();
  });

  it("renders the default mic label on the first paint", async () => {
    const SettingsPanel = (await import("./SettingsPanel")).default;
    const { container, unmount } = render(React.createElement(SettingsPanel));

    expect(container.textContent ?? "").toContain("System Default");

    unmount();
  });

  it("shows only the local Whisper model in the Models tab (no providers/cloud)", async () => {
    const SettingsPanel = (await import("./SettingsPanel")).default;
    const { container, unmount } = render(React.createElement(SettingsPanel));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const settingsText = container.textContent ?? "";
    expect(settingsText).toContain("Defaults");
    expect(settingsText).not.toContain("API Keys");

    const modelsTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Models",
    );
    expect(modelsTab).toBeTruthy();
    await act(async () => {
      modelsTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    // Only the local model remains.
    expect(text).toContain("Whisper Large v3 Turbo");
    // Cloud provider / API-key UI is gone.
    expect(text).not.toContain("Default Model");
    expect(text).not.toContain("Cloud Providers");
    expect(text).not.toContain("OpenAI");
    expect(text).not.toContain("Groq");
    expect(text).not.toContain("Deepgram");

    unmount();
  });
});
