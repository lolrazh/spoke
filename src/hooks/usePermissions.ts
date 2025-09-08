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
  askIM: () => Promise<{
    success: boolean;
    status: "authorized" | "denied" | string;
  }>;
  requestAccessibilityPermission: () => Promise<{ success: boolean }>;
  openSystemPreferences: (
    pane: "microphone" | "input-monitoring" | "accessibility",
  ) => void | Promise<void>;
};

export type PermissionsState = {
  microphone: boolean;
  inputMonitoring: boolean;
  accessibility: boolean;
};

export type PermissionUiState = {
  microphone: { loading: boolean; justGranted: boolean };
  inputMonitoring: { loading: boolean; justGranted: boolean };
  accessibility: { loading: boolean; justGranted: boolean };
};

type Options = {
  pollIntervalMs?: number;
  deepLinkGraceMs?: number;
};

const defaultProvider: PermissionProvider | null =
  typeof window !== "undefined" && window.electron
    ? {
        checkPermissions: async () =>
          (await window.electron?.checkPermissions?.()) || {},
        checkMicrophonePermission: async () =>
          (await window.electron?.checkMicrophonePermission?.()) || {
            granted: false,
          },
        requestMicrophonePermission: async () =>
          (await window.electron?.requestMicrophonePermission?.()) || {
            success: false,
            granted: false,
          },
        askIM: async () =>
          (await window.electron?.askIM?.()) || {
            success: false,
            status: "denied",
          },
        requestAccessibilityPermission: async () =>
          (await window.electron?.requestAccessibilityPermission?.()) || {
            success: false,
          },
        openSystemPreferences: (pane) =>
          window.electron?.openSystemPreferences?.(pane),
      }
    : null;

export function usePermissions(provider?: PermissionProvider, opts?: Options) {
  const p: PermissionProvider =
    provider ??
    defaultProvider ?? {
      checkPermissions: async () => ({ needAX: true, needIM: true, isDev: false }),
      checkMicrophonePermission: async () => ({ granted: false, status: "unknown" }),
      requestMicrophonePermission: async () => ({ success: false, granted: false }),
      askIM: async () => ({ success: false, status: "denied" }),
      requestAccessibilityPermission: async () => ({ success: false }),
      openSystemPreferences: () => undefined,
    };
  const pollMs = opts?.pollIntervalMs ?? 1000;

  const [permissions, setPermissions] = useState<PermissionsState>({
    microphone: false,
    inputMonitoring: false,
    accessibility: false,
  });
  const [ui, setUi] = useState<PermissionUiState>({
    microphone: { loading: false, justGranted: false },
    inputMonitoring: { loading: false, justGranted: false },
    accessibility: { loading: false, justGranted: false },
  });

  const timersRef = useRef<{
    mic: ReturnType<typeof setInterval> | null;
    im: ReturnType<typeof setInterval> | null;
    ax: ReturnType<typeof setInterval> | null;
  }>({ mic: null, im: null, ax: null });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timersRef.current.mic) clearInterval(timersRef.current.mic);
      if (timersRef.current.im) clearInterval(timersRef.current.im);
      if (timersRef.current.ax) clearInterval(timersRef.current.ax);
      timersRef.current = { mic: null, im: null, ax: null };
    };
  }, []);

  const init = async () => {
    try {
      const [sys, mic] = await Promise.all([
        p.checkPermissions(),
        p.checkMicrophonePermission(),
      ]);
      if (!mountedRef.current) return;
      setPermissions({
        microphone: !!mic?.granted,
        inputMonitoring: !(sys?.needIM ?? true),
        accessibility: !(sys?.needAX ?? true),
      });
    } catch {}
  };

  const requestMicrophone = async () => {
    try {
      setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, loading: true } }));
      const res = await p.requestMicrophonePermission();
      if (res?.success && res?.granted) {
        setPermissions((prev) => ({ ...prev, microphone: true }));
        setUi((prev) => ({ ...prev, microphone: { loading: false, justGranted: true } }));
        try { await (window as any)?.electron?.postPermissionGrant?.("microphone"); } catch {}
        setTimeout(() => {
          if (!mountedRef.current) return;
          setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, justGranted: false } }));
        }, 800);
        return;
      }
      // Open System Settings and poll
      try { p.openSystemPreferences("microphone"); } catch {}
      if (timersRef.current.mic) clearInterval(timersRef.current.mic);
      timersRef.current.mic = setInterval(async () => {
        const status = await p.checkMicrophonePermission();
        if (status?.granted) {
          clearInterval(timersRef.current.mic);
          timersRef.current.mic = null;
          setPermissions((prev) => ({ ...prev, microphone: true }));
          setUi((prev) => ({ ...prev, microphone: { loading: false, justGranted: true } }));
          try { await (window as any)?.electron?.postPermissionGrant?.("microphone"); } catch {}
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

  const requestInputMonitoring = async () => {
    try {
      setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, loading: true } }));
      const out = await p.askIM();
      if (out?.success && out.status === "authorized") {
        setPermissions((prev) => ({ ...prev, inputMonitoring: true }));
        setUi((prev) => ({ ...prev, inputMonitoring: { loading: false, justGranted: true } }));
        setTimeout(() => {
          if (!mountedRef.current) return;
          setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, justGranted: false } }));
        }, 800);
        return;
      }
      try { p.openSystemPreferences("input-monitoring"); } catch {}
      if (timersRef.current.im) clearInterval(timersRef.current.im);
      timersRef.current.im = setInterval(async () => {
        const sys = await p.checkPermissions();
        if (sys && !sys.needIM) {
          clearInterval(timersRef.current.im);
          timersRef.current.im = null;
          setPermissions((prev) => ({ ...prev, inputMonitoring: true }));
          setUi((prev) => ({ ...prev, inputMonitoring: { loading: false, justGranted: true } }));
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
        const out = await p.requestAccessibilityPermission();
        if (out?.success) {
          // Will still require user to toggle in System Settings; start polling
        }
        try { p.openSystemPreferences("accessibility"); } catch {}
        if (timersRef.current.ax) clearInterval(timersRef.current.ax);
        timersRef.current.ax = setInterval(async () => {
          const sys = await p.checkPermissions();
          if (sys && !sys.needAX) {
            clearInterval(timersRef.current.ax);
            timersRef.current.ax = null;
            setPermissions((prev) => ({ ...prev, accessibility: true }));
            setUi((prev) => ({ ...prev, accessibility: { loading: false, justGranted: true } }));
            try { await (window as any)?.electron?.postPermissionGrant?.("accessibility"); } catch {}
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

  return useMemo(
    () => ({
      permissions,
      ui,
      init,
      requestMicrophone,
      requestInputMonitoring,
      requestAccessibility,
      setPermissions, // exposed for dev overlays/tests
    }),
    [permissions, ui],
  );
}
