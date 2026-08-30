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
});

contextBridge.exposeInMainWorld("contextMenu", {
  showPill: () => ipcRenderer.send("show-pill-context-menu"),
});

contextBridge.exposeInMainWorld("clipboard", {
  insertText: (text: string) =>
    ipcRenderer.invoke("insert-text-at-cursor", text),
  writeText: (text: string) => ipcRenderer.invoke("clipboard:write-text", text),
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
    const listener = () => cb();
    ipcRenderer.on("ptt-down", listener);
    return () => ipcRenderer.removeListener("ptt-down", listener);
  },
  onUp: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("ptt-up", listener);
    return () => ipcRenderer.removeListener("ptt-up", listener);
  },
  onReady: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("ptt-ready", listener);
    return () => ipcRenderer.removeListener("ptt-ready", listener);
  },
  onCancel: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("ptt-cancel", listener);
    return () => ipcRenderer.removeListener("ptt-cancel", listener);
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
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { id: string },
    ) => cb(payload);
    ipcRenderer.on("mic:selected-changed", listener);
    return () => ipcRenderer.removeListener("mic:selected-changed", listener);
  },
});

// Native macOS audio capture bridge. Frames are forwarded as raw little-endian
// PCM16 bytes; the renderer converts them to Int16Array before VAD/chunking.
contextBridge.exposeInMainWorld("audioCapture", {
  isAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke("audio-capture:is-available"),
  listDevices: (): Promise<MicDevice[]> =>
    ipcRenderer.invoke("audio-capture:list-devices"),
  start: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("audio-capture:start"),
  stop: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("audio-capture:stop"),
  cancel: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("audio-capture:cancel"),
  onFrame: (cb: (payload: Uint8Array) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Uint8Array) =>
      cb(payload);
    ipcRenderer.on("audio-capture:frame", listener);
    return () => ipcRenderer.removeListener("audio-capture:frame", listener);
  },
  onStopped: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("audio-capture:stopped", listener);
    return () => ipcRenderer.removeListener("audio-capture:stopped", listener);
  },
  onError: (cb: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) =>
      cb(message);
    ipcRenderer.on("audio-capture:error", listener);
    return () => ipcRenderer.removeListener("audio-capture:error", listener);
  },
});

// Local Whisper bridge
contextBridge.exposeInMainWorld("stt", {
  transcribeLocal: (
    modelId: string,
    pcmBuffer: ArrayBuffer | Uint8Array,
    prompt?: string,
  ) =>
    ipcRenderer.invoke(
      "stt:transcribe-local",
      modelId,
      pcmBuffer,
      prompt,
    ),
  cancelLocalTranscription: () =>
    ipcRenderer.invoke("stt:cancel-local-transcription"),
  startLocalStream: (modelId: string): Promise<{ sessionId: string }> =>
    ipcRenderer.invoke("stt:start-local-stream", modelId),
  pushLocalStream: (sessionId: string, pcmBuffer: ArrayBuffer) =>
    ipcRenderer.invoke(
      "stt:push-local-stream",
      sessionId,
      pcmBuffer,
    ),
  finishLocalStream: (sessionId: string) =>
    ipcRenderer.invoke("stt:finish-local-stream", sessionId),
  onLocalStreamPartial: (
    cb: (payload: { sessionId: string; text: string }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string; text: string },
    ) => cb(payload);
    ipcRenderer.on("stt:local-stream-partial", listener);
    return () =>
      ipcRenderer.removeListener("stt:local-stream-partial", listener);
  },
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
      audioBuffer: new Uint8Array(payload.audioBuffer),
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
  getModelStatuses: () => ipcRenderer.invoke("stt:get-model-statuses"),
  getModelInfos: () => ipcRenderer.invoke("stt:get-model-infos"),
  getActiveModel: () => ipcRenderer.invoke("stt:get-active-model"),
  setActiveModel: (modelId: string) =>
    ipcRenderer.invoke("stt:set-active-model", modelId),
  installModel: (modelId?: string) =>
    ipcRenderer.invoke("stt:install-model", modelId),
  removeModel: (modelId?: string) =>
    ipcRenderer.invoke("stt:remove-model", modelId),
  cancelInstall: (modelId?: string) =>
    ipcRenderer.invoke("stt:cancel-install", modelId),
  prewarmLocal: () => ipcRenderer.invoke("stt:prewarm-local"),
  onModelProgress: (
    cb: (payload: {
      modelId: string;
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

contextBridge.exposeInMainWorld("electron", {
  setClickThrough: (clickThrough: boolean) =>
    ipcRenderer.send("set-click-through", clickThrough),
  setFocusable: (focusable: boolean) =>
    ipcRenderer.send("set-focusable", focusable),
  focusWindow: () => ipcRenderer.send("focus-window"),
  expandPill: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("expand-pill", listener);
    return () => ipcRenderer.removeListener("expand-pill", listener);
  },
  onPasteShortcutPressed: (callback: () => void) => {
    ipcRenderer.on("paste-shortcut-pressed", callback);
    return () => ipcRenderer.removeListener("paste-shortcut-pressed", callback);
  },
  revealPillForTest: () => ipcRenderer.invoke("pill:reveal-for-test"),
  // Onboarding APIs
  checkPermissions: () => ipcRenderer.invoke("check-permissions"),
  requestAccessibilityPermission: () =>
    ipcRenderer.invoke("request-accessibility-permission"),
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
  getOnboardingStep: (): Promise<string | null> =>
    ipcRenderer.invoke("onboarding:get-step"),
  setOnboardingStep: (step: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("onboarding:set-step", step),
  // Permission lifecycle helpers
  postPermissionGrant: (type: "accessibility" | "microphone") =>
    ipcRenderer.invoke("permissions:post-grant", type),
  // Onboarding window control
  closeOnboarding: () => ipcRenderer.invoke("close-onboarding"),
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
  // Auto-space helpers (trailing space after inserted dictation)
  getAutoSpaceEnabled: (): Promise<{ enabled: boolean }> =>
    ipcRenderer.invoke("auto-space:get-enabled"),
  setAutoSpaceEnabled: (
    enabled: boolean,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("auto-space:set-enabled", { enabled }),
  // Vocabulary dictionary (words/phrases used to correct transcripts)
  getVocabularyDictionary: (): Promise<{ dictionary: string[] }> =>
    ipcRenderer.invoke("vocabulary:get-dictionary"),
  addVocabularyEntry: (value: string) =>
    ipcRenderer.invoke("vocabulary:add-entry", { value }),
  updateVocabularyEntry: (currentValue: string, nextValue: string) =>
    ipcRenderer.invoke("vocabulary:update-entry", { currentValue, nextValue }),
  removeVocabularyEntry: (value: string) =>
    ipcRenderer.invoke("vocabulary:remove-entry", { value }),
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
});

// Expose application metadata
contextBridge.exposeInMainWorld("app", {
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
});

contextBridge.exposeInMainWorld("update", {
  getState: () => ipcRenderer.invoke("update:get-state"),
  restart: () => ipcRenderer.invoke("update:restart"),
  installWhenReady: () => ipcRenderer.invoke("update:install-when-ready"),
  onStateChanged: (cb: (snapshot: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown) =>
      cb(snapshot);
    ipcRenderer.on("update:state-changed", listener);
    return () => ipcRenderer.removeListener("update:state-changed", listener);
  },
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
    return () => ipcRenderer.removeListener("active-display", listener);
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
