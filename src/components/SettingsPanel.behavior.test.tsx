import React, { act } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
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
      getDockVisible: async () => ({ visible: true }),
      setDockVisible: vi.fn(async (_visible: boolean) => ({ ok: true })),
      getAutoSpaceEnabled: async () => ({ enabled: true }),
      setAutoSpaceEnabled: vi.fn(async (_enabled: boolean) => ({ ok: true })),
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
      onSelectedChanged: (_cb: (p: { id: string }) => void) => () => {},
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
    await act(async () => {
      first.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onToggle).toHaveBeenCalled();

    unmount();
  }, 10_000);

  it("persists the auto-space preference when user toggles the switch", async () => {
    const SettingsPanel = (await import("./SettingsPanel")).default;
    const { container, unmount } = render(React.createElement(SettingsPanel));
    await act(async () => {
      await Promise.resolve();
    });

    const switches = Array.from(container.querySelectorAll(".switch-track"));
    // Defaults group order: Floating Bar, Dock, Auto-Space
    const autoSpaceSwitch = switches[2] as HTMLElement;
    await act(async () => {
      autoSpaceSwitch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect((window as any).electron.setAutoSpaceEnabled).toHaveBeenCalledWith(
      false,
    );

    unmount();
  }, 10_000);

  it("selects a microphone through the native control", async () => {
    const SettingsPanel = (await import("./SettingsPanel")).default;
    const { container, unmount } = render(React.createElement(SettingsPanel));
    await act(async () => {
      await Promise.resolve();
    });

    const select = container.querySelector(
      'select[aria-label="Microphone"]',
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.options).toHaveLength(3);

    await act(async () => {
      if (!select) return;
      select.value = "mic2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect((window as any).mic.select).toHaveBeenCalledWith("mic2");
    unmount();
  }, 10_000);
});
