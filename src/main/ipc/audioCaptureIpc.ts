import { ipcMain } from "electron";

import {
  isNativeAudioCaptureAvailable,
  listNativeAudioDevices,
  nativeAudioCapture,
} from "../audioCapture";
import { getSelectedMicId } from "../micManager";

export function registerAudioCaptureIpc(): void {
  ipcMain.handle("audio-capture:is-available", () => {
    return isNativeAudioCaptureAvailable();
  });

  ipcMain.handle("audio-capture:list-devices", async () => {
    return listNativeAudioDevices();
  });

  ipcMain.handle("audio-capture:start", (event, sessionId: string) => {
    validateSessionId(sessionId);
    return nativeAudioCapture
      .start(event.sender, getSelectedMicId(), sessionId)
      .then(() => ({ ok: true }));
  });

  ipcMain.handle("audio-capture:stop", async (event, sessionId: string) => {
    validateSessionId(sessionId);
    await nativeAudioCapture.stop(event.sender, sessionId);
    return { ok: true };
  });

  ipcMain.handle("audio-capture:cancel", (event, sessionId: string) => {
    validateSessionId(sessionId);
    nativeAudioCapture.cancel(event.sender, sessionId);
    return { ok: true };
  });
}

function validateSessionId(sessionId: unknown): asserts sessionId is string {
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("An audio capture session ID is required.");
  }
}
