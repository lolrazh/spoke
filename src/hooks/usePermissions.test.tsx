import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PermissionProvider } from "./usePermissions";
import { usePermissions } from "./usePermissions";

function createProvider(): PermissionProvider {
  return {
    checkPermissions: vi.fn(async () => ({
      needAX: false,
      needIM: false,
      isDev: false,
    })),
    checkMicrophonePermission: vi.fn(async () => ({
      granted: true,
      status: "granted",
    })),
    requestMicrophonePermission: vi.fn(async () => ({
      success: true,
      granted: true,
    })),
    checkScreenRecordingPermission: vi.fn(async () => ({
      granted: true,
      status: "granted",
    })),
    requestScreenRecordingPermission: vi.fn(async () => ({
      success: true,
      granted: true,
    })),
    askIM: vi.fn(async () => ({
      success: true,
      status: "authorized",
    })),
    requestAccessibilityPermission: vi.fn(async () => ({ success: true })),
    openSystemPreferences: vi.fn(),
  };
}

describe("usePermissions", () => {
  it("keeps the state identity stable for an unchanged refresh", async () => {
    const provider = createProvider();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return usePermissions(provider, { includeScreenRecording: true });
    });

    await act(async () => {
      await result.current.init();
    });

    const permissions = result.current.permissions;
    const rendersAfterFirstInit = renders;

    await act(async () => {
      await result.current.init();
    });

    expect(result.current.permissions).toBe(permissions);
    expect(renders).toBe(rendersAfterFirstInit);
    expect(provider.checkPermissions).toHaveBeenCalledTimes(2);
    expect(provider.checkMicrophonePermission).toHaveBeenCalledTimes(2);
    expect(provider.checkScreenRecordingPermission).toHaveBeenCalledTimes(2);
  });
});
