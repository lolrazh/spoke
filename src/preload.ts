// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import type {
  ActiveDisplayPayload,
  MicDevice,
  TranscriptionItem,
} from "./types/shared";

// Expose dev flags so renderer can bypass onboarding in development
contextBridge.exposeInMainWorld("devFlags", {
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

// Local Whisper bridge
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
  prewarmLocal: () => ipcRenderer.invoke("stt:prewarm-local"),
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
  enhance: (payload: {
    text: string;
    vocabulary?: string[];
    mode?: "dictation" | "edit";
    selectionText?: string;
  }) => ipcRenderer.invoke("stt:enhance", payload),
  extractOcr: (imageBase64: string) =>
    ipcRenderer.invoke("stt:extract-ocr", imageBase64),
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
  // Generic external URL opener
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  // Renderer lifecycle
  rendererReady: () => ipcRenderer.send("renderer-ready"),
  bootMark: (label: string) =>
    ipcRenderer.send("boot:renderer-mark", {
      label,
      rendererMs: Math.round(performance.now()),
    }),
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
