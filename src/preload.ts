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
});

contextBridge.exposeInMainWorld("island", {
  slideTo: (y: number) => ipcRenderer.send("island-slide", y),
});

contextBridge.exposeInMainWorld("electron", {
  resizePill: (width: number) => ipcRenderer.send("pill-resize", width),
});
