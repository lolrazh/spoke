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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

  it("coalesces concurrent permission initializations", async () => {
    const provider = createProvider();
    const systemCheck = deferred<{
      needAX?: boolean;
      needIM?: boolean;
      isDev?: boolean;
    }>();
    provider.checkPermissions = vi.fn(() => systemCheck.promise);
    const { result } = renderHook(() =>
      usePermissions(provider, { includeScreenRecording: true }),
    );

    const first = result.current.init();
    const second = result.current.init();

    expect(second).toBe(first);
    expect(provider.checkPermissions).toHaveBeenCalledOnce();
    expect(provider.checkMicrophonePermission).toHaveBeenCalledOnce();
    expect(provider.checkScreenRecordingPermission).toHaveBeenCalledOnce();

    await act(async () => {
      systemCheck.resolve({ needAX: false, needIM: false, isDev: false });
      await first;
    });
  });

  it("does not overlap microphone permission polls", async () => {
    vi.useFakeTimers();
    try {
      const provider = createProvider();
      provider.requestMicrophonePermission = vi.fn(async () => ({
        success: false,
        granted: false,
      }));
      const firstCheck = deferred<{
        granted: boolean;
        status: string;
      }>();
      const secondCheck = deferred<{
        granted: boolean;
        status: string;
      }>();
      provider.checkMicrophonePermission = vi
        .fn()
        .mockImplementationOnce(() => firstCheck.promise)
        .mockImplementationOnce(() => secondCheck.promise);

      const { result, unmount } = renderHook(() =>
        usePermissions(provider, { pollIntervalMs: 1000 }),
      );

      await act(async () => {
        await result.current.requestMicrophone();
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(provider.checkMicrophonePermission).toHaveBeenCalledOnce();

      await act(async () => {
        firstCheck.resolve({ granted: false, status: "denied" });
        await firstCheck.promise;
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(provider.checkMicrophonePermission).toHaveBeenCalledTimes(2);

      await act(async () => {
        secondCheck.resolve({ granted: false, status: "denied" });
        await secondCheck.promise;
      });
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
