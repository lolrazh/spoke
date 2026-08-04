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

  ipcMain.handle("audio-capture:start", (event) => {
    return nativeAudioCapture
      .start(event.sender, getSelectedMicId())
      .then(() => ({ ok: true }));
  });

  ipcMain.handle("audio-capture:stop", async () => {
    await nativeAudioCapture.stop();
    return { ok: true };
  });

  ipcMain.handle("audio-capture:cancel", () => {
    nativeAudioCapture.cancel();
    return { ok: true };
  });
}
