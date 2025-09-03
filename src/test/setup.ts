// Minimal test environment shims for DOM, media, and Electron bridges

// MediaDevices shim
if (typeof globalThis.navigator === "undefined") {
  // @ts-ignore
  globalThis.navigator = {};
}
// @ts-ignore
if (!globalThis.navigator.mediaDevices) {
  // @ts-ignore
  globalThis.navigator.mediaDevices = {
    addEventListener: (_: string, __: any) => {},
    removeEventListener: (_: string, __: any) => {},
    enumerateDevices: async () => [],
    getUserMedia: async (_: MediaStreamConstraints) =>
      ({
        getTracks: () => [{ stop: () => {} }],
      }) as unknown as MediaStream,
  } as any;
}

// Electron bridge shim (only what tests might touch indirectly)
// @ts-ignore
if (!globalThis.window) {
  // @ts-ignore
  globalThis.window = {};
}
// @ts-ignore
if (!globalThis.window.electron) {
  // @ts-ignore
  globalThis.window.electron = {
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
  } as any;
}

// Clipboard shim
// @ts-ignore
if (!globalThis.window.clipboard) {
  // @ts-ignore
  globalThis.window.clipboard = {
    insertText: async (_text: string) => ({ success: true }),
  } as any;
}

// Mic bridge shim used by utils/components
// @ts-ignore
if (!globalThis.window.mic) {
  let selected = "default";
  // @ts-ignore
  globalThis.window.mic = {
    updateDevices: (_d: any, _s?: string) => {},
    select: async (id: string) => {
      selected = id;
      return { ok: true };
    },
    getSelected: async () => ({ id: selected }),
    onSelectedChanged: (cb: (p: { id: string }) => void) => {
      // return unsubscribe
      return () => void cb;
    },
    onRefreshRequest: (_cb: () => void) => () => {},
  } as any;
}

// Dev flags default
// @ts-ignore
if (!globalThis.window.devFlags) {
  // @ts-ignore
  globalThis.window.devFlags = {
    skipAuth: false,
    skipOnboarding: false,
    forceOnboarding: false,
    devConsoleLogs: false,
  };
}
