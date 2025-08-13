// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import type { ActiveDisplayPayload } from "./types/shared";

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
import type { MicDevice } from "./types/shared";

contextBridge.exposeInMainWorld("mic", {
  /** Send the current discovered set of microphone devices to main. */
  updateDevices: (devices: MicDevice[], selectedId?: string) => {
    ipcRenderer.send("mic:devices-update", { devices, selectedId });
  },
  /** Ask main to change the selected microphone (persist + broadcast). */
  select: (id: string) => ipcRenderer.invoke("mic:select", { id }),
  /** Get the currently selected microphone id from main. */
  getSelected: (): Promise<{ id: string }> => ipcRenderer.invoke("mic:get-selected"),
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
  setClickThrough: (clickThrough: boolean) =>
    ipcRenderer.send("set-click-through", clickThrough),
  setFocusable: (focusable: boolean) => ipcRenderer.send("set-focusable", focusable),
  focusWindow: () => ipcRenderer.send("focus-window"),
  expandPill: (callback: () => void) => {
    ipcRenderer.on("expand-pill", callback);
  },
  requestExpandPill: () => ipcRenderer.invoke("pill:expand"),
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
  // Generic external URL opener for OAuth links
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  // Return the active redirect URL the renderer should use
  getAuthRedirectUrl: () => ipcRenderer.invoke("auth:get-redirect-url"),
});

// Auth bridge: receive deep link callback URLs
contextBridge.exposeInMainWorld("auth", {
  onCallback: (cb: (payload: { url: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { url: string }) => cb(payload);
    ipcRenderer.on("auth:callback", listener);
    return () => ipcRenderer.removeListener("auth:callback", listener);
  },
});

// Event bridge for active display updates
contextBridge.exposeInMainWorld("onActiveDisplay", (cb: (payload: ActiveDisplayPayload) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: ActiveDisplayPayload) => cb(payload);
  ipcRenderer.on("active-display", listener);
});

// Forward collapse-request from main to the renderer via a window message
ipcRenderer.on("collapse-request", () => {
  try {
    window.postMessage('collapse-request', '*');
  } catch {
    // ignore
  }
});