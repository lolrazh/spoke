import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import PermissionsPanel from "./PermissionsPanel";
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

describe("components/PermissionsPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    (window as any).electron = {
      checkPermissions: async () => ({
        needAX: true,
        needIM: true,
        isDev: true,
      }),
      checkMicrophonePermission: async () => ({
        granted: false,
        status: "denied",
      }),
      requestMicrophonePermission: vi.fn(async () => ({
        success: true,
        granted: true,
      })),
      requestAccessibilityPermission: vi.fn(async () => ({ success: true })),
      askIM: vi.fn(async () => ({ success: true, status: "authorized" })),
      openSystemPreferences: vi.fn(),
    };
  });

  it("renders all permission cards and wires enable buttons", async () => {
    const { container, unmount } = render(
      React.createElement(PermissionsPanel, null),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const cards = container.querySelectorAll(".settings-card");
    expect(cards.length).toBeGreaterThanOrEqual(3);

    const micCard = container.querySelector(
      '.settings-card[aria-label="Voice Input"]',
    ) as HTMLElement | null;
    expect(micCard).not.toBeNull();

    const micButton = micCard?.querySelector(
      "button",
    ) as HTMLButtonElement | null;
    expect(micButton).not.toBeNull();

    micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.electron.requestMicrophonePermission).toHaveBeenCalled();

    unmount();
  });
});
