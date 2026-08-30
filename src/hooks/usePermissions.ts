import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";

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
    pane:
      | "microphone"
      | "input-monitoring"
      | "accessibility"
      | "screen-recording",
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

const DEFAULT_PERMISSIONS: PermissionsState = {
  microphone: false,
  screenRecording: false,
  inputMonitoring: false,
  accessibility: false,
};

const DEFAULT_PERMISSION_UI: PermissionUiState = {
  microphone: { loading: false, justGranted: false },
  screenRecording: { loading: false, justGranted: false },
  inputMonitoring: { loading: false, justGranted: false },
  accessibility: { loading: false, justGranted: false },
};

function samePermissions(
  previous: PermissionsState | null,
  next: PermissionsState,
): boolean {
  return (
    previous !== null &&
    previous.microphone === next.microphone &&
    previous.screenRecording === next.screenRecording &&
    previous.inputMonitoring === next.inputMonitoring &&
    previous.accessibility === next.accessibility
  );
}

type Options = {
  pollIntervalMs?: number;
  includeScreenRecording?: boolean;
};

const debugPermLog = (...args: unknown[]) => {
  if (typeof window === "undefined") return;
  if (!window?.devFlags?.devConsoleLogs) return;
  try {
    console.debug("[Permissions]", new Date().toISOString(), ...args);
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
          const res =
            await window.electron?.requestScreenRecordingPermission?.();
          return {
            success: !!res?.success,
            granted: res?.granted ?? false,
          };
        },
        askIM: async () => {
          const res = await window.electron?.askIM?.();
          return {
            success: !!res?.success,
            status:
              (res?.status as "authorized" | "denied" | string) ?? "denied",
          };
        },
        requestAccessibilityPermission: async () => {
          const res =
            (await window.electron?.requestAccessibilityPermission?.()) as
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
  const p: PermissionProvider = provider ??
    defaultProvider ?? {
      checkPermissions: async () => ({
        needAX: true,
        needIM: true,
        isDev: false,
      }),
      checkMicrophonePermission: async () => ({
        granted: false,
        status: "unknown",
      }),
      requestMicrophonePermission: async () => ({
        success: false,
        granted: false,
      }),
      checkScreenRecordingPermission: async () => ({
        granted: false,
        status: "unknown",
      }),
      requestScreenRecordingPermission: async () => ({
        success: false,
        granted: false,
      }),
      askIM: async () => ({ success: false, status: "denied" }),
      requestAccessibilityPermission: async () => ({ success: false }),
      openSystemPreferences: () => undefined,
    };
  const pollMs = opts?.pollIntervalMs ?? 1000;
  const includeScreenRecording = opts?.includeScreenRecording ?? true;

  const [permissions, setPermissionsState] = useState<PermissionsState>(
    DEFAULT_PERMISSIONS,
  );
  const [ui, setUi] = useState<PermissionUiState>(DEFAULT_PERMISSION_UI);
  // False until the first init() resolves, so consumers can avoid rendering
  // the default (all-denied) state before the real one is known.
  const [loaded, setLoaded] = useState(false);

  const permissionsRef = useRef(DEFAULT_PERMISSIONS);
  const loadedRef = useRef(false);
  const prevPermissionsRef = useRef<PermissionsState | null>(null);
  const timersRef = useRef<{
    mic: ReturnType<typeof setInterval> | null;
    sr: ReturnType<typeof setInterval> | null;
    im: ReturnType<typeof setInterval> | null;
    ax: ReturnType<typeof setInterval> | null;
  }>({ mic: null, sr: null, im: null, ax: null });
  const mountedRef = useRef(true);

  const updatePermissions = useCallback(
    (nextOrUpdater: SetStateAction<PermissionsState>) => {
      const nextPermissions =
        typeof nextOrUpdater === "function"
          ? nextOrUpdater(permissionsRef.current)
          : nextOrUpdater;
      if (samePermissions(permissionsRef.current, nextPermissions)) return;
      permissionsRef.current = nextPermissions;
      setPermissionsState(nextPermissions);
    },
    [],
  );

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
        includeScreenRecording
          ? p.checkScreenRecordingPermission()
          : Promise.resolve({ granted: false, status: "disabled" }),
      ]);
      if (!mountedRef.current) return;
      const nextPermissions: PermissionsState = {
        microphone: !!mic?.granted,
        screenRecording: includeScreenRecording ? !!sr?.granted : false,
        inputMonitoring: !(sys?.needIM ?? true),
        accessibility: !(sys?.needAX ?? true),
      };
      updatePermissions(nextPermissions);
      debugPermLog("init:snapshot", {
        needAX: sys?.needAX ?? true,
        needIM: sys?.needIM ?? true,
        micStatus: mic?.status ?? "unknown",
        screenRecordingStatus: sr?.status ?? "unknown",
        permissions: nextPermissions,
      });
    } catch {
      // ignore; pollers/focus retries will recover
    } finally {
      // Mark loaded after the first attempt (success or failure) so the UI
      // doesn't sit on a placeholder forever.
      if (mountedRef.current && !loadedRef.current) {
        loadedRef.current = true;
        setLoaded(true);
      }
    }
  };

  const requestMicrophone = async () => {
    try {
      setUi((prev) => ({
        ...prev,
        microphone: { ...prev.microphone, loading: true },
      }));
      debugPermLog("request:microphone:start");
      const res = await p.requestMicrophonePermission();
      if (res?.success && res?.granted) {
        updatePermissions((prev) => ({ ...prev, microphone: true }));
        setUi((prev) => ({
          ...prev,
          microphone: { loading: false, justGranted: true },
        }));
        debugPermLog("request:microphone:granted");
        try {
          await window.electron?.postPermissionGrant?.("microphone");
        } catch {}
        setTimeout(() => {
          if (!mountedRef.current) return;
          setUi((prev) => ({
            ...prev,
            microphone: { ...prev.microphone, justGranted: false },
          }));
        }, 800);
        return;
      }
      // Open System Settings and poll
      try {
        p.openSystemPreferences("microphone");
      } catch {}
      debugPermLog("request:microphone:polling");
      if (timersRef.current.mic) clearInterval(timersRef.current.mic);
      const micTimer = setInterval(async () => {
        const status = await p.checkMicrophonePermission();
        if (status?.granted) {
          clearInterval(micTimer);
          timersRef.current.mic = null;
          updatePermissions((prev) => ({ ...prev, microphone: true }));
          setUi((prev) => ({
            ...prev,
            microphone: { loading: false, justGranted: true },
          }));
          debugPermLog("request:microphone:granted-via-poll");
          try {
            await window.electron?.postPermissionGrant?.("microphone");
          } catch {}
          setTimeout(() => {
            if (!mountedRef.current) return;
            setUi((prev) => ({
              ...prev,
              microphone: { ...prev.microphone, justGranted: false },
            }));
          }, 800);
        }
      }, pollMs);
      timersRef.current.mic = micTimer;
      setUi((prev) => ({
        ...prev,
        microphone: { ...prev.microphone, loading: false },
      }));
    } catch {
      setUi((prev) => ({
        ...prev,
        microphone: { ...prev.microphone, loading: false },
      }));
    }
  };

  const requestScreenRecording = async () => {
    if (!includeScreenRecording) return;
    try {
      setUi((prev) => ({
        ...prev,
        screenRecording: { ...prev.screenRecording, loading: true },
      }));
      debugPermLog("request:screen-recording:start");
      const res = await p.requestScreenRecordingPermission();
      if (res?.success && res?.granted) {
        updatePermissions((prev) => ({ ...prev, screenRecording: true }));
        setUi((prev) => ({
          ...prev,
          screenRecording: { loading: false, justGranted: true },
        }));
        debugPermLog("request:screen-recording:granted");
        setTimeout(() => {
          if (!mountedRef.current) return;
          setUi((prev) => ({
            ...prev,
            screenRecording: { ...prev.screenRecording, justGranted: false },
          }));
        }, 800);
        return;
      }
      // Open System Settings and poll
      try {
        p.openSystemPreferences("screen-recording");
      } catch {}
      debugPermLog("request:screen-recording:polling");
      if (timersRef.current.sr) clearInterval(timersRef.current.sr);
      const srTimer = setInterval(async () => {
        const status = await p.checkScreenRecordingPermission();
        if (status?.granted) {
          clearInterval(srTimer);
          timersRef.current.sr = null;
          updatePermissions((prev) => ({ ...prev, screenRecording: true }));
          setUi((prev) => ({
            ...prev,
            screenRecording: { loading: false, justGranted: true },
          }));
          debugPermLog("request:screen-recording:granted-via-poll");
          setTimeout(() => {
            if (!mountedRef.current) return;
            setUi((prev) => ({
              ...prev,
              screenRecording: { ...prev.screenRecording, justGranted: false },
            }));
          }, 800);
        }
      }, pollMs);
      timersRef.current.sr = srTimer;
      setUi((prev) => ({
        ...prev,
        screenRecording: { ...prev.screenRecording, loading: false },
      }));
    } catch {
      setUi((prev) => ({
        ...prev,
        screenRecording: { ...prev.screenRecording, loading: false },
      }));
    }
  };

  const requestInputMonitoring = async () => {
    try {
      setUi((prev) => ({
        ...prev,
        inputMonitoring: { ...prev.inputMonitoring, loading: true },
      }));
      debugPermLog("request:input-monitoring:start");
      const out = await p.askIM();
      if (out?.success && out.status === "authorized") {
        updatePermissions((prev) => ({ ...prev, inputMonitoring: true }));
        setUi((prev) => ({
          ...prev,
          inputMonitoring: { loading: false, justGranted: true },
        }));
        debugPermLog("request:input-monitoring:authorized");
        setTimeout(() => {
          if (!mountedRef.current) return;
          setUi((prev) => ({
            ...prev,
            inputMonitoring: { ...prev.inputMonitoring, justGranted: false },
          }));
        }, 800);
        return;
      }
      try {
        p.openSystemPreferences("input-monitoring");
      } catch {}
      debugPermLog("request:input-monitoring:polling");
      if (timersRef.current.im) clearInterval(timersRef.current.im);
      const imTimer = setInterval(async () => {
        const sys = await p.checkPermissions();
        if (sys && !sys.needIM) {
          clearInterval(imTimer);
          timersRef.current.im = null;
          updatePermissions((prev) => ({ ...prev, inputMonitoring: true }));
          setUi((prev) => ({
            ...prev,
            inputMonitoring: { loading: false, justGranted: true },
          }));
          debugPermLog("request:input-monitoring:authorized-via-poll");
          setTimeout(() => {
            if (!mountedRef.current) return;
            setUi((prev) => ({
              ...prev,
              inputMonitoring: { ...prev.inputMonitoring, justGranted: false },
            }));
          }, 800);
        }
      }, pollMs);
      timersRef.current.im = imTimer;
      setUi((prev) => ({
        ...prev,
        inputMonitoring: { ...prev.inputMonitoring, loading: false },
      }));
    } catch {
      setUi((prev) => ({
        ...prev,
        inputMonitoring: { ...prev.inputMonitoring, loading: false },
      }));
    }
  };

  const requestAccessibility = async () => {
    try {
      setUi((prev) => ({
        ...prev,
        accessibility: { ...prev.accessibility, loading: true },
      }));
      debugPermLog("request:accessibility:start");
      const out = await p.requestAccessibilityPermission();
      if (out?.success) {
        // Will still require user to toggle in System Settings; start polling
      }
      if (timersRef.current.ax) clearInterval(timersRef.current.ax);
      const axTimer = setInterval(async () => {
        const sys = await p.checkPermissions();
        if (sys && !sys.needAX) {
          clearInterval(axTimer);
          timersRef.current.ax = null;
          updatePermissions((prev) => ({ ...prev, accessibility: true }));
          setUi((prev) => ({
            ...prev,
            accessibility: { loading: false, justGranted: true },
          }));
          debugPermLog("request:accessibility:authorized");
          try {
            await window.electron?.postPermissionGrant?.("accessibility");
          } catch {}
          setTimeout(() => {
            if (!mountedRef.current) return;
            setUi((prev) => ({
              ...prev,
              accessibility: { ...prev.accessibility, justGranted: false },
            }));
          }, 800);
        }
      }, pollMs);
      timersRef.current.ax = axTimer;
      setUi((prev) => ({
        ...prev,
        accessibility: { ...prev.accessibility, loading: false },
      }));
    } catch {
      setUi((prev) => ({
        ...prev,
        accessibility: { ...prev.accessibility, loading: false },
      }));
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
      loaded,
      init,
      requestMicrophone,
      requestScreenRecording,
      requestInputMonitoring,
      requestAccessibility,
      setPermissions: updatePermissions, // exposed for dev overlays/tests
    }),
    [permissions, ui, loaded, updatePermissions],
  );
}
