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

describe("components/SettingsPanel behavior", () => {
  beforeEach(() => {
    window.localStorage.clear();
    (window as any).electron = {
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
      showOnboarding: async () => ({ ok: true }),
      openSystemPreferences: async () => {},
    };
    (window as any).mic = {
      select: vi.fn(async (_id: string) => ({ ok: true })),
      getSelected: vi.fn(async () => ({ id: "default" })),
      onSelectedChanged: (cb: (p: { id: string }) => void) => () => {},
      onRefreshRequest: (_cb: () => void) => () => {},
      updateDevices: (_d: unknown, _s?: string) => {},
    } as any;
    // Media devices
    // @ts-ignore
    navigator.mediaDevices = {
      enumerateDevices: vi.fn(
        async () =>
          [
            { kind: "audioinput", deviceId: "mic1", label: "Mic 1" },
            { kind: "audioinput", deviceId: "mic2", label: "Mic 2" },
          ] as any,
      ),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as any;
  });

  it("fires onToggleFloatingBar when user toggles the switch", async () => {
    const SettingsPanel = (await import("./SettingsPanel")).default;
    const onToggle = vi.fn();
    const { container, unmount } = render(
      React.createElement(SettingsPanel, { onToggleFloatingBar: onToggle }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    const switches = Array.from(container.querySelectorAll(".switch-track"));
    // First switch is "Show Floating Bar"
    const first = switches[0] as HTMLElement;
    first.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onToggle).toHaveBeenCalled();

    unmount();
  });
});
