// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electron", {
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

  showPillContextMenu: () => {
    ipcRenderer.send("show-pill-context-menu");
  },
  insertTextAtCursor: (text: string) => {
    return ipcRenderer.invoke("insert-text-at-cursor", text);
  },
  // Method to view the log file
  viewLogFile: () => {
    return ipcRenderer.invoke("view-log-file");
  },
  // Add a method for the renderer to request a notification
  sendNotification: (message: string) => {
    ipcRenderer.send("show-notification", message);
  },
  // Method for Groq transcription
  transcribeGroq: async (
    audioBuffer: ArrayBuffer,
    transferList?: Transferable[],
    upstreamTimings?: Record<string, number>,
  ) => {
    const t0 = performance.now();
    const res = await ipcRenderer.invoke(
      "transcribe-groq",
      audioBuffer,
      transferList,
      upstreamTimings,
    );
    if (res.timings) {
      res.timings.ipc_to_main = performance.now() - t0;
    }
    return res;
  },
  // Method for Gemini transcription
  transcribeGemini: async (
    audioBuffer: ArrayBuffer,
    mimeType: string,
    transferList?: Transferable[],
    upstreamTimings?: Record<string, number>,
  ) => {
    const t0 = performance.now();
    const res = await ipcRenderer.invoke(
      "transcribe-gemini",
      audioBuffer,
      mimeType,
      transferList,
      upstreamTimings,
    );
    if (res.timings) {
      res.timings.ipc_to_main = performance.now() - t0;
    }
    return res;
  },
  warmUpConnection: (engine: "groq" | "gemini") =>
    ipcRenderer.send("warm-up-connection", engine),
  // Function key push-to-talk events
  onPTTDown: (cb: () => void) => {
    ipcRenderer.removeAllListeners("ptt-down");
    ipcRenderer.on("ptt-down", cb);
    return () => ipcRenderer.removeAllListeners("ptt-down");
  },
  onPTTUp: (cb: () => void) => {
    ipcRenderer.removeAllListeners("ptt-up");
    ipcRenderer.on("ptt-up", cb);
    return () => ipcRenderer.removeAllListeners("ptt-up");
  },
});

contextBridge.exposeInMainWorld("electronIsland", {
  slideTo: (y: number) => ipcRenderer.send("island-slide", y),
});
