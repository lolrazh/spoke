import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { PermissionsProvider } from "../state/permissionsContext";

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

  it("renders provider controls without hosted account or quota sections", async () => {
    const SettingsPanel = (await import("./SettingsPanel")).default;
    const { container, unmount } = render(React.createElement(SettingsPanel));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Providers");
    expect(text).toContain("API Keys");
    expect(text).toContain("OpenAI API Key");
    expect(text).not.toContain("Account");
    expect(text).not.toContain("Usage");
    expect(text).not.toContain("Sign In");

    unmount();
  });
});
