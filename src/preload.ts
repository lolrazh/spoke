// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import type {
  ActiveDisplayPayload,
  MicDevice,
  TranscriptionItem,
} from "./types/shared";

// ============================================================================
// CRITICAL: Pre-inject Supabase session (MUST run before any renderer code)
// ============================================================================
// Electron's localStorage is unreliable with file:// URLs in packaged builds.
// We store Supabase session in electron-store and inject it here.
//
// IMPORTANT: We expose a "waitForSessionReady" function so the renderer can WAIT
// for session injection to complete before initializing Supabase.
// This prevents the race condition where Supabase reads empty localStorage.
//
// NOTE: We use a function that returns a promise, NOT a bare promise, because
// contextBridge can only serialize promises returned from functions.
// ============================================================================

let sessionReadyResolve: () => void;
const sessionReadyPromise = new Promise<void>((resolve) => {
  sessionReadyResolve = resolve;
});

(async () => {
  try {
    const sessionData = (await ipcRenderer.invoke("session:get-all")) as Record<
      string,
      string
    >;
    for (const [key, value] of Object.entries(sessionData)) {
      localStorage.setItem(key, value);
    }
  } catch (error) {
    console.error("[Preload] Failed to inject session:", error);
  } finally {
    // Always resolve - even on error, so the app doesn't hang
    sessionReadyResolve();
  }
})();

// Expose a FUNCTION that returns the promise - bare promises don't serialize!
contextBridge.exposeInMainWorld(
  "waitForSessionReady",
  () => sessionReadyPromise,
);

// Expose dev flags so renderer can bypass auth/onboarding in development
contextBridge.exposeInMainWorld("devFlags", {
  skipAuth:
    process.env.SKIP_AUTH === "1" || process.env.SKIP_AUTH === "true" || false,
  skipOnboarding:
    process.env.SKIP_ONBOARDING === "1" ||
    process.env.SKIP_ONBOARDING === "true" ||
    false,
  forceOnboarding:
    process.env.FORCE_ONBOARDING === "1" ||
    process.env.FORCE_ONBOARDING === "true" ||
    false,
  devConsoleLogs:
    process.env.SF_DEVTOOLS === "1" ||
    process.env.SF_DEVTOOLS === "true" ||
    false,
  // Renderer-friendly mirrors for intro testing (support both VITE_* and non-VITE names)
  introOnly:
    process.env.VITE_INTRO_ONLY === "1" ||
    process.env.VITE_INTRO_ONLY === "true" ||
    process.env.INTRO_ONLY === "1" ||
    process.env.INTRO_ONLY === "true" ||
    false,
  replayIntro:
    process.env.VITE_REPLAY_INTRO === "1" ||
    process.env.VITE_REPLAY_INTRO === "true" ||
    process.env.REPLAY_INTRO === "1" ||
    process.env.REPLAY_INTRO === "true" ||
    false,
});

contextBridge.exposeInMainWorld("contextMenu", {
  showPill: () => ipcRenderer.send("show-pill-context-menu"),
});

contextBridge.exposeInMainWorld("transcript", {
  update: (text: string) => ipcRenderer.send("transcript:update", text),
  subscribe: (cb: (text: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, text: string) =>
      cb(text);
    ipcRenderer.on("transcript:updated", listener);
    return () => ipcRenderer.removeListener("transcript:updated", listener);
  },
});

contextBridge.exposeInMainWorld("clipboard", {
  insertText: (text: string) =>
    ipcRenderer.invoke("insert-text-at-cursor", text),
});

contextBridge.exposeInMainWorld("selection", {
  inspect: (options?: { contextChars?: number }) =>
    ipcRenderer.invoke("selection:inspect", options ?? {}),
});

contextBridge.exposeInMainWorld("notifications", {
  send: (message: string, actionId?: string | null) =>
    ipcRenderer.send("show-notification", {
      message,
      actionId: actionId ?? null,
    }),
  on: (
    callback: (payload: { message: string; actionId?: string | null }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { message: string; actionId?: string | null } | string,
    ) => {
      if (typeof payload === "string") {
        callback({ message: payload, actionId: null });
        return;
      }
      callback({
        message: payload?.message ?? "",
        actionId:
          typeof payload?.actionId === "string" ? payload.actionId : null,
      });
    };
    ipcRenderer.on("notify", listener);

    return () => {
      ipcRenderer.removeListener("notify", listener);
    };
  },
});

contextBridge.exposeInMainWorld("ptt", {
  onDown: (cb: () => void) => {
    ipcRenderer.removeAllListeners("ptt-down");
    ipcRenderer.on("ptt-down", cb);
    return () => ipcRenderer.removeAllListeners("ptt-down");
  },
  onUp: (cb: () => void) => {
    ipcRenderer.removeAllListeners("ptt-up");
    ipcRenderer.on("ptt-up", cb);
    return () => ipcRenderer.removeAllListeners("ptt-up");
  },
  onReady: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("ptt-ready", listener);
    return () => ipcRenderer.removeListener("ptt-ready", listener);
  },
  onCancelDown: (cb: () => void) => {
    ipcRenderer.removeAllListeners("ptt-cancel-down");
    ipcRenderer.on("ptt-cancel-down", cb);
    return () => ipcRenderer.removeAllListeners("ptt-cancel-down");
  },
  onCancel: (cb: () => void) => {
    ipcRenderer.removeAllListeners("ptt-cancel");
    ipcRenderer.on("ptt-cancel", cb);
    return () => ipcRenderer.removeAllListeners("ptt-cancel");
  },
});

// Microphone device management bridge
contextBridge.exposeInMainWorld("mic", {
  /** Send the current discovered set of microphone devices to main. */
  updateDevices: (devices: MicDevice[], selectedId?: string) => {
    ipcRenderer.send("mic:devices-update", { devices, selectedId });
  },
  /** Ask main to change the selected microphone (persist + broadcast). */
  select: (id: string) => ipcRenderer.invoke("mic:select", { id }),
  /** Get the currently selected microphone id from main. */
  getSelected: (): Promise<{ id: string }> =>
    ipcRenderer.invoke("mic:get-selected"),
  /** Subscribe to selection changes coming from main. */
  onSelectedChanged: (cb: (payload: { id: string }) => void) => {
    ipcRenderer.on("mic:selected-changed", (_e, payload) => cb(payload));
    return () => ipcRenderer.removeAllListeners("mic:selected-changed");
  },
  /** Subscribe to refresh device requests from main. */
  onRefreshRequest: (cb: () => void) => {
    ipcRenderer.on("mic:refresh-devices", cb);
    return () => ipcRenderer.removeAllListeners("mic:refresh-devices");
  },
});

// Local STT bridge
contextBridge.exposeInMainWorld("stt", {
  transcribeLocal: (pcmBuffer: ArrayBuffer) =>
    ipcRenderer.invoke("stt:transcribe-local", Buffer.from(pcmBuffer)),
  transcribeApiKeyProvider: (
    providerId: string,
    payload: {
      audioBuffer: ArrayBuffer;
      mimeType?: string;
      context: unknown;
    },
  ) =>
    ipcRenderer.invoke("stt:transcribe-api-key-provider", {
      providerId,
      audioBuffer: Buffer.from(payload.audioBuffer),
      mimeType: payload.mimeType,
      context: payload.context,
    }),
  getProviderSettings: () => ipcRenderer.invoke("stt:get-provider-settings"),
  getPreferredProvider: () => ipcRenderer.invoke("stt:get-preferred-provider"),
  setPreferredProvider: (providerId: string) =>
    ipcRenderer.invoke("stt:set-preferred-provider", providerId),
  setProviderApiKey: (providerId: string, apiKey: string) =>
    ipcRenderer.invoke("stt:set-provider-api-key", { providerId, apiKey }),
  clearProviderApiKey: (providerId: string) =>
    ipcRenderer.invoke("stt:clear-provider-api-key", providerId),
  getModelStatus: () => ipcRenderer.invoke("stt:get-model-status"),
  installModel: () => ipcRenderer.invoke("stt:install-model"),
  removeModel: () => ipcRenderer.invoke("stt:remove-model"),
  onModelProgress: (
    cb: (payload: {
      progress: number;
      downloadedBytes: number;
      totalBytes: number;
    }) => void,
  ) => {
    const handler = (_event: any, payload: any) => cb(payload);
    ipcRenderer.on("stt:model-download-progress", handler);
    return () => {
      ipcRenderer.removeListener("stt:model-download-progress", handler);
    };
  },
});

contextBridge.exposeInMainWorld("island", {
  slideTo: (y: number) => ipcRenderer.send("island-slide", y),
});

contextBridge.exposeInMainWorld("electron", {
  setClickThrough: (clickThrough: boolean) =>
    ipcRenderer.send("set-click-through", clickThrough),
  setFocusable: (focusable: boolean) =>
    ipcRenderer.send("set-focusable", focusable),
  focusWindow: () => ipcRenderer.send("focus-window"),
  expandPill: (callback: () => void) => {
    ipcRenderer.on("expand-pill", callback);
  },
  onPasteShortcutPressed: (callback: () => void) => {
    ipcRenderer.on("paste-shortcut-pressed", callback);
    return () => ipcRenderer.removeListener("paste-shortcut-pressed", callback);
  },
  requestExpandPill: () => ipcRenderer.invoke("pill:expand"),
  revealPill: () => ipcRenderer.invoke("pill:reveal"),
  revealPillForTest: () => ipcRenderer.invoke("pill:reveal-for-test"),
  // Onboarding APIs
  checkPermissions: () => ipcRenderer.invoke("check-permissions"),
  requestAccessibilityPermission: () =>
    ipcRenderer.invoke("request-accessibility-permission"),
  requestInputMonitoringPermission: () =>
    ipcRenderer.invoke("request-input-monitoring-permission"),
  askIM: () => ipcRenderer.invoke("ask-im"),
  requestMicrophonePermission: () =>
    ipcRenderer.invoke("request-microphone-permission"),
  checkMicrophonePermission: () =>
    ipcRenderer.invoke("check-microphone-permission"),
  requestScreenRecordingPermission: () =>
    ipcRenderer.invoke("request-screen-recording-permission"),
  checkScreenRecordingPermission: () =>
    ipcRenderer.invoke("check-screen-recording-permission"),
  openSystemPreferences: (pane: string) =>
    ipcRenderer.invoke("open-system-preferences", pane),
  startHelper: () => ipcRenderer.invoke("helper:start"),
  preparePill: () => ipcRenderer.invoke("prepare-pill"),
  setPttTarget: (target: "auto" | "onboarding" | "main") =>
    ipcRenderer.invoke("ptt:set-target", target),
  reloadApp: () => ipcRenderer.invoke("reload-app"),
  onboardingComplete: () => ipcRenderer.invoke("onboarding-complete"),
  resetOnboardingFlag: () => ipcRenderer.invoke("onboarding:reset-local-flag"),
  getOnboardingStep: (): Promise<string | null> =>
    ipcRenderer.invoke("onboarding:get-step"),
  setOnboardingStep: (step: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("onboarding:set-step", step),
  getAppPath: () => ipcRenderer.invoke("get-app-path"),
  // Permission lifecycle helpers
  postPermissionGrant: (type: "accessibility" | "microphone") =>
    ipcRenderer.invoke("permissions:post-grant", type),
  // Window controls
  showOnboarding: () => ipcRenderer.invoke("auth:show-onboarding"),
  closeOnboarding: () => ipcRenderer.invoke("close-onboarding"),
  minimizeOnboarding: () => ipcRenderer.invoke("minimize-onboarding"),
  maximizeOnboarding: () => ipcRenderer.invoke("maximize-onboarding"),
  // Floating bar visibility helpers
  isFloatingBarVisible: (): Promise<{ visible: boolean }> =>
    ipcRenderer.invoke("floating-bar:is-visible"),
  getFloatingBarEnabled: (): Promise<{ enabled: boolean }> =>
    ipcRenderer.invoke("floating-bar:get-enabled"),
  hideFloatingBarIndefinitely: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("floating-bar:hide-indefinitely"),
  showFloatingBar: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("floating-bar:show"),
  // Dock visibility helpers (macOS only)
  getDockVisible: (): Promise<{ visible: boolean }> =>
    ipcRenderer.invoke("dock:get-visible"),
  setDockVisible: (
    visible: boolean,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("dock:set-visible", { visible }),
  // Generic external URL opener for OAuth links
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  // Return the active redirect URL the renderer should use
  getAuthRedirectUrl: () => ipcRenderer.invoke("auth:get-redirect-url"),
  // Renderer lifecycle
  rendererReady: () => ipcRenderer.send("renderer-ready"),
  // Screenshot capture (Phase 1 OCR)
  takeScreenshot: (options?: {
    display?: "active" | number;
    quality?: number;
    maxDimension?: number;
  }) => ipcRenderer.invoke("screenshot:capture", options),
  testScreenshot: () => ipcRenderer.invoke("screenshot:test"),
});

// Expose application metadata
contextBridge.exposeInMainWorld("app", {
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
});

// Transcription history storage bridge
contextBridge.exposeInMainWorld("transcriptions", {
  getAll: (): Promise<TranscriptionItem[]> =>
    ipcRenderer.invoke("transcriptions:get-all"),
  save: (payload: {
    text: string;
    timestamp: number;
    mode: "dictation" | "edit";
  }): Promise<TranscriptionItem> =>
    ipcRenderer.invoke("transcriptions:save", payload),
  delete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("transcriptions:delete", { id }),
  clear: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("transcriptions:clear"),
});

// Session storage bridge (for Supabase session sync)
contextBridge.exposeInMainWorld("supabaseSession", {
  setItem: (key: string, value: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("session:set", { key, value }),
  getItem: (key: string): Promise<string | null> =>
    ipcRenderer.invoke("session:get", { key }),
  removeItem: (key: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("session:remove", { key }),
  clearAll: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("session:clear-all"),
});

// (Removed) dev-only Sentry verification hooks

// Auth bridge: receive deep link callback URLs
contextBridge.exposeInMainWorld("auth", {
  onCallback: (cb: (payload: { url: string }) => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      payload: { url: string },
    ) => cb(payload);
    ipcRenderer.on("auth:callback", listener);
    return () => ipcRenderer.removeListener("auth:callback", listener);
  },
});

// Event bridge for active display updates
contextBridge.exposeInMainWorld(
  "onActiveDisplay",
  (cb: (payload: ActiveDisplayPayload) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: ActiveDisplayPayload,
    ) => cb(payload);
    ipcRenderer.on("active-display", listener);
  },
);

// Forward collapse-request from main to the renderer via a window message
ipcRenderer.on("collapse-request", () => {
  try {
    window.postMessage("collapse-request", "*");
  } catch {
    // ignore
  }
});
