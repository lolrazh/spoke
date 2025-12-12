import { useEffect, useMemo, useRef, useState } from "react";

export type PermissionProvider = {
  checkPermissions: () => Promise<{
    needAX?: boolean;
    needIM?: boolean;
    isDev?: boolean;
  }>;
  checkMicrophonePermission: () => Promise<{
    granted: boolean;
    status?: string;
  }>;
  requestMicrophonePermission: () => Promise<{
    success: boolean;
    granted: boolean;
  }>;
  checkScreenRecordingPermission: () => Promise<{
    granted: boolean;
    status?: string;
  }>;
  requestScreenRecordingPermission: () => Promise<{
    success: boolean;
    granted: boolean;
  }>;
  askIM: () => Promise<{
    success: boolean;
    status: "authorized" | "denied" | string;
  }>;
  requestAccessibilityPermission: () => Promise<{ success: boolean }>;
  openSystemPreferences: (
    pane: "microphone" | "input-monitoring" | "accessibility" | "screen-recording",
  ) => void | Promise<void>;
};

export type PermissionsState = {
  microphone: boolean;
  screenRecording: boolean;
  inputMonitoring: boolean;
  accessibility: boolean;
};

export type PermissionUiState = {
  microphone: { loading: boolean; justGranted: boolean };
  screenRecording: { loading: boolean; justGranted: boolean };
  inputMonitoring: { loading: boolean; justGranted: boolean };
  accessibility: { loading: boolean; justGranted: boolean };
};

type Options = {
  pollIntervalMs?: number;
  deepLinkGraceMs?: number;
};

const debugPermLog = (...args: unknown[]) => {
  if (typeof window === "undefined") return;
  if (!window?.devFlags?.devConsoleLogs) return;
  try {
    console.debug(
      "[Permissions]",
      new Date().toISOString(),
      ...args,
    );
  } catch {
    // ignore logging errors
  }
};

const defaultProvider: PermissionProvider | null =
  typeof window !== "undefined" && window.electron
    ? {
        checkPermissions: async () => {
          const res = await window.electron?.checkPermissions?.();
          return {
            needAX: res?.needAX ?? true,
            needIM: res?.needIM ?? true,
            isDev: res?.isDev ?? false,
          };
        },
        checkMicrophonePermission: async () => {
          const res = await window.electron?.checkMicrophonePermission?.();
          return {
            granted: res?.granted ?? false,
            status: res?.status ?? "unknown",
          };
        },
        requestMicrophonePermission: async () => {
          const res = await window.electron?.requestMicrophonePermission?.();
          return {
            success: !!res?.success,
            granted: res?.granted ?? false,
          };
        },
        checkScreenRecordingPermission: async () => {
          const res = await window.electron?.checkScreenRecordingPermission?.();
          return {
            granted: res?.granted ?? false,
            status: res?.status ?? "unknown",
          };
        },
        requestScreenRecordingPermission: async () => {
          const res = await window.electron?.requestScreenRecordingPermission?.();
          return {
            success: !!res?.success,
            granted: res?.granted ?? false,
          };
        },
        askIM: async () => {
          const res = await window.electron?.askIM?.();
          return {
            success: !!res?.success,
            status: (res?.status as "authorized" | "denied" | string) ?? "denied",
          };
        },
        requestAccessibilityPermission: async () => {
          const res = (await window.electron?.requestAccessibilityPermission?.()) as
            | { success?: boolean }
            | void
            | undefined;
          return {
            success:
              !!res && typeof res === "object" && "success" in res
                ? !!(res as { success?: boolean }).success
                : false,
          };
        },
        openSystemPreferences: (pane) => {
          void window.electron?.openSystemPreferences?.(pane);
        },
      }
    : null;

export function usePermissions(provider?: PermissionProvider, opts?: Options) {
  const p: PermissionProvider =
    provider ??
    defaultProvider ?? {
      checkPermissions: async () => ({ needAX: true, needIM: true, isDev: false }),
      checkMicrophonePermission: async () => ({ granted: false, status: "unknown" }),
      requestMicrophonePermission: async () => ({ success: false, granted: false }),
      checkScreenRecordingPermission: async () => ({ granted: false, status: "unknown" }),
      requestScreenRecordingPermission: async () => ({ success: false, granted: false }),
      askIM: async () => ({ success: false, status: "denied" }),
      requestAccessibilityPermission: async () => ({ success: false }),
      openSystemPreferences: () => undefined,
    };
  const pollMs = opts?.pollIntervalMs ?? 1000;

  const [permissions, setPermissions] = useState<PermissionsState>({
    microphone: false,
    screenRecording: false,
    inputMonitoring: false,
    accessibility: false,
  });
  const [ui, setUi] = useState<PermissionUiState>({
    microphone: { loading: false, justGranted: false },
    screenRecording: { loading: false, justGranted: false },
    inputMonitoring: { loading: false, justGranted: false },
    accessibility: { loading: false, justGranted: false },
  });

  const prevPermissionsRef = useRef<PermissionsState | null>(null);
  const timersRef = useRef<{
    mic: ReturnType<typeof setInterval> | null;
    sr: ReturnType<typeof setInterval> | null;
    im: ReturnType<typeof setInterval> | null;
    ax: ReturnType<typeof setInterval> | null;
  }>({ mic: null, sr: null, im: null, ax: null });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timersRef.current.mic) clearInterval(timersRef.current.mic);
      if (timersRef.current.sr) clearInterval(timersRef.current.sr);
      if (timersRef.current.im) clearInterval(timersRef.current.im);
      if (timersRef.current.ax) clearInterval(timersRef.current.ax);
      timersRef.current = { mic: null, sr: null, im: null, ax: null };
      debugPermLog("cleanup:cleared-pollers");
    };
  }, []);

  const init = async () => {
    try {
      const [sys, mic, sr] = await Promise.all([
        p.checkPermissions(),
        p.checkMicrophonePermission(),
        p.checkScreenRecordingPermission(),
      ]);
      if (!mountedRef.current) return;
      const nextPermissions: PermissionsState = {
        microphone: !!mic?.granted,
        screenRecording: !!sr?.granted,
        inputMonitoring: !(sys?.needIM ?? true),
        accessibility: !(sys?.needAX ?? true),
      };
      setPermissions(nextPermissions);
      debugPermLog("init:snapshot", {
        needAX: sys?.needAX ?? true,
        needIM: sys?.needIM ?? true,
        micStatus: mic?.status ?? "unknown",
        screenRecordingStatus: sr?.status ?? "unknown",
        permissions: nextPermissions,
      });
    } catch {}
  };

  const requestMicrophone = async () => {
    try {
      setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, loading: true } }));
      debugPermLog("request:microphone:start");
      const res = await p.requestMicrophonePermission();
      if (res?.success && res?.granted) {
        setPermissions((prev) => ({ ...prev, microphone: true }));
        setUi((prev) => ({ ...prev, microphone: { loading: false, justGranted: true } }));
        debugPermLog("request:microphone:granted");
        try { await window.electron?.postPermissionGrant?.("microphone"); } catch {}
        setTimeout(() => {
          if (!mountedRef.current) return;
          setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, justGranted: false } }));
        }, 800);
        return;
      }
      // Open System Settings and poll
      try { p.openSystemPreferences("microphone"); } catch {}
      debugPermLog("request:microphone:polling");
      if (timersRef.current.mic) clearInterval(timersRef.current.mic);
      timersRef.current.mic = setInterval(async () => {
        const status = await p.checkMicrophonePermission();
        if (status?.granted) {
          clearInterval(timersRef.current.mic);
          timersRef.current.mic = null;
          setPermissions((prev) => ({ ...prev, microphone: true }));
          setUi((prev) => ({ ...prev, microphone: { loading: false, justGranted: true } }));
          debugPermLog("request:microphone:granted-via-poll");
          try { await window.electron?.postPermissionGrant?.("microphone"); } catch {}
          setTimeout(() => {
            if (!mountedRef.current) return;
            setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, justGranted: false } }));
          }, 800);
        }
      }, pollMs);
      setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, loading: false } }));
    } catch {
      setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, loading: false } }));
    }
  };

  const requestScreenRecording = async () => {
    try {
      setUi((prev) => ({ ...prev, screenRecording: { ...prev.screenRecording, loading: true } }));
      debugPermLog("request:screen-recording:start");
      const res = await p.requestScreenRecordingPermission();
      if (res?.success && res?.granted) {
        setPermissions((prev) => ({ ...prev, screenRecording: true }));
        setUi((prev) => ({ ...prev, screenRecording: { loading: false, justGranted: true } }));
        debugPermLog("request:screen-recording:granted");
        setTimeout(() => {
          if (!mountedRef.current) return;
          setUi((prev) => ({ ...prev, screenRecording: { ...prev.screenRecording, justGranted: false } }));
        }, 800);
        return;
      }
      // Open System Settings and poll
      try { p.openSystemPreferences("screen-recording"); } catch {}
      debugPermLog("request:screen-recording:polling");
      if (timersRef.current.sr) clearInterval(timersRef.current.sr);
      timersRef.current.sr = setInterval(async () => {
        const status = await p.checkScreenRecordingPermission();
        if (status?.granted) {
          clearInterval(timersRef.current.sr);
          timersRef.current.sr = null;
          setPermissions((prev) => ({ ...prev, screenRecording: true }));
          setUi((prev) => ({ ...prev, screenRecording: { loading: false, justGranted: true } }));
          debugPermLog("request:screen-recording:granted-via-poll");
          setTimeout(() => {
            if (!mountedRef.current) return;
            setUi((prev) => ({ ...prev, screenRecording: { ...prev.screenRecording, justGranted: false } }));
          }, 800);
        }
      }, pollMs);
      setUi((prev) => ({ ...prev, screenRecording: { ...prev.screenRecording, loading: false } }));
    } catch {
      setUi((prev) => ({ ...prev, screenRecording: { ...prev.screenRecording, loading: false } }));
    }
  };

  const requestInputMonitoring = async () => {
    try {
      setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, loading: true } }));
      debugPermLog("request:input-monitoring:start");
      const out = await p.askIM();
      if (out?.success && out.status === "authorized") {
        setPermissions((prev) => ({ ...prev, inputMonitoring: true }));
        setUi((prev) => ({ ...prev, inputMonitoring: { loading: false, justGranted: true } }));
        debugPermLog("request:input-monitoring:authorized");
        setTimeout(() => {
          if (!mountedRef.current) return;
          setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, justGranted: false } }));
        }, 800);
        return;
      }
      try { p.openSystemPreferences("input-monitoring"); } catch {}
      debugPermLog("request:input-monitoring:polling");
      if (timersRef.current.im) clearInterval(timersRef.current.im);
      timersRef.current.im = setInterval(async () => {
        const sys = await p.checkPermissions();
        if (sys && !sys.needIM) {
          clearInterval(timersRef.current.im);
          timersRef.current.im = null;
          setPermissions((prev) => ({ ...prev, inputMonitoring: true }));
          setUi((prev) => ({ ...prev, inputMonitoring: { loading: false, justGranted: true } }));
          debugPermLog("request:input-monitoring:authorized-via-poll");
          setTimeout(() => {
            if (!mountedRef.current) return;
            setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, justGranted: false } }));
          }, 800);
        }
      }, pollMs);
      setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, loading: false } }));
    } catch {
      setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, loading: false } }));
    }
  };

  const requestAccessibility = async () =>
    {
      try {
        setUi((prev) => ({ ...prev, accessibility: { ...prev.accessibility, loading: true } }));
        debugPermLog("request:accessibility:start");
        const out = await p.requestAccessibilityPermission();
        if (out?.success) {
          // Will still require user to toggle in System Settings; start polling
        }
        if (timersRef.current.ax) clearInterval(timersRef.current.ax);
        timersRef.current.ax = setInterval(async () => {
          const sys = await p.checkPermissions();
          if (sys && !sys.needAX) {
            clearInterval(timersRef.current.ax);
            timersRef.current.ax = null;
            setPermissions((prev) => ({ ...prev, accessibility: true }));
            setUi((prev) => ({ ...prev, accessibility: { loading: false, justGranted: true } }));
            debugPermLog("request:accessibility:authorized");
            try { await window.electron?.postPermissionGrant?.("accessibility"); } catch {}
            setTimeout(() => {
              if (!mountedRef.current) return;
              setUi((prev) => ({ ...prev, accessibility: { ...prev.accessibility, justGranted: false } }));
            }, 800);
          }
        }, pollMs);
        setUi((prev) => ({ ...prev, accessibility: { ...prev.accessibility, loading: false } }));
      } catch {
      setUi((prev) => ({ ...prev, accessibility: { ...prev.accessibility, loading: false } }));
    }
  };

  useEffect(() => {
    const previous = prevPermissionsRef.current;
    if (!previous) {
      debugPermLog("state:init", permissions);
      prevPermissionsRef.current = permissions;
      return;
    }
    if (
      previous.microphone !== permissions.microphone ||
      previous.inputMonitoring !== permissions.inputMonitoring ||
      previous.accessibility !== permissions.accessibility
    ) {
      debugPermLog("state:change", {
        from: previous,
        to: permissions,
      });
    }
    prevPermissionsRef.current = permissions;
  }, [permissions]);

  return useMemo(
    () => ({
      permissions,
      ui,
      init,
      requestMicrophone,
      requestScreenRecording,
      requestInputMonitoring,
      requestAccessibility,
      setPermissions, // exposed for dev overlays/tests
    }),
    [permissions, ui],
  );
}
