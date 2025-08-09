// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("app", {
  toggleDictation: (callback: () => void) => {
    // Remove any existing listeners to prevent duplicates
    ipcRenderer.removeAllListeners("toggle-dictation");
    // Add the new listener
    ipcRenderer.on("toggle-dictation", () => callback());

    // Return a cleanup function that can be called when the component unmounts
    return () => {
      ipcRenderer.removeAllListeners("toggle-dictation");
    };
  },
  viewLogFile: () => ipcRenderer.invoke("view-log-file"),
});

contextBridge.exposeInMainWorld("contextMenu", {
  showPill: () => ipcRenderer.send("show-pill-context-menu"),
});

contextBridge.exposeInMainWorld("transcript", {
  update: (text: string) => ipcRenderer.send("transcript:update", text),
});

contextBridge.exposeInMainWorld("clipboard", {
  insertText: (text: string) =>
    ipcRenderer.invoke("insert-text-at-cursor", text),
});

contextBridge.exposeInMainWorld("notifications", {
  send: (message: string) => ipcRenderer.send("show-notification", message),
  on: (callback: (message: string) => void) => {
    ipcRenderer.on("notify", (_event, message) => callback(message));

    return () => {
      ipcRenderer.removeAllListeners("notify");
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
});

// Microphone device management bridge
type MicDevice = { id: string; label: string };

contextBridge.exposeInMainWorld("mic", {
  /** Send the current discovered set of microphone devices to main. */
  updateDevices: (devices: MicDevice[], selectedId?: string) => {
    ipcRenderer.send("mic:devices-update", { devices, selectedId });
  },
  /** Ask main to change the selected microphone (persist + broadcast). */
  select: (id: string) => ipcRenderer.invoke("mic:select", { id }),
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

contextBridge.exposeInMainWorld("island", {
  slideTo: (y: number) => ipcRenderer.send("island-slide", y),
});

contextBridge.exposeInMainWorld("electron", {
  resizePill: (width: number, height: number) =>
    ipcRenderer.send("pill-resize", { width, height }),
  setClickThrough: (clickThrough: boolean) =>
    ipcRenderer.send("set-click-through", clickThrough),
  pillShow: () => ipcRenderer.send("pill-show"),
  pillHide: () => ipcRenderer.send("pill-hide"),
  pillRendererReady: () => ipcRenderer.send("pill-renderer-ready"),
  onPillRendererReady: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("pill-renderer-ready", listener);
    return () => ipcRenderer.removeListener("pill-renderer-ready", listener);
  },
  expandPill: (callback: () => void) => {
    ipcRenderer.on("expand-pill", callback);
  },
  // Onboarding APIs
  checkPermissions: () => ipcRenderer.invoke("check-permissions"),
  requestAccessibilityPermission: () => ipcRenderer.invoke("request-accessibility-permission"),
  requestInputMonitoringPermission: () => ipcRenderer.invoke("request-input-monitoring-permission"),
  askIM: () => ipcRenderer.invoke("ask-im"),
  requestMicrophonePermission: () => ipcRenderer.invoke("request-microphone-permission"),
  checkMicrophonePermission: () => ipcRenderer.invoke("check-microphone-permission"),
  openSystemPreferences: (pane: string) => ipcRenderer.invoke("open-system-preferences", pane),
  startHelper: () => ipcRenderer.invoke("helper:start"),
  preparePill: () => ipcRenderer.invoke("prepare-pill"),
  setPttTarget: (target: "auto" | "onboarding" | "main") => ipcRenderer.invoke("ptt:set-target", target),
  reloadApp: () => ipcRenderer.invoke("reload-app"),
  onboardingComplete: () => ipcRenderer.invoke("onboarding-complete"),
  getAppPath: () => ipcRenderer.invoke("get-app-path"),
  // Window controls
  closeOnboarding: () => ipcRenderer.invoke("close-onboarding"),
  minimizeOnboarding: () => ipcRenderer.invoke("minimize-onboarding"),
  maximizeOnboarding: () => ipcRenderer.invoke("maximize-onboarding"),
});