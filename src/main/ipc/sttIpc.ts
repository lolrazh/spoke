/**
 * STT IPC
 *
 * Local model-manager, sidecar transcription and live-stream handlers.
 */

import { ipcMain } from "electron";
import { randomUUID } from "crypto";

import {
  installLocalModelAndSyncSidecar,
  prewarmLocalSidecar,
  removeLocalModelAndStopSidecar,
  selectActiveModel,
  transcribeWithLocalSidecar,
  abortLocalSidecarTranscription,
  beginLocalStreamingSession,
} from "../localSttLifecycle";
import {
  getModelStatus,
  getAllModelStatuses,
  getActiveModelId,
  cancelInstall,
} from "../modelManager";
import { listModelInfos } from "../localModelContract";
import { scheduleLocalSidecarPrewarm } from "../windows";
import { LocalStreamIpcController } from "./localStreamIpcController";

const localStreams = new LocalStreamIpcController(
  beginLocalStreamingSession,
  abortLocalSidecarTranscription,
  randomUUID,
);

export function registerSttIpc(): void {
  // ============ Local Whisper IPC handlers ============

  ipcMain.handle("stt:get-model-status", () => {
    return getModelStatus();
  });

  ipcMain.handle("stt:get-model-statuses", () => {
    return getAllModelStatuses();
  });

  ipcMain.handle("stt:get-active-model", () => {
    return getActiveModelId();
  });

  ipcMain.handle("stt:get-model-infos", () => {
    return listModelInfos();
  });

  ipcMain.handle("stt:set-active-model", (_event, modelId: string) => {
    selectActiveModel(modelId);
  });

  ipcMain.handle("stt:prewarm-local", () => {
    prewarmLocalSidecar("renderer");
    return { ok: true };
  });

  ipcMain.handle("stt:install-model", async (_event, modelId?: string) => {
    await installLocalModelAndSyncSidecar(modelId);
    scheduleLocalSidecarPrewarm("model-install", 250);
  });

  ipcMain.handle("stt:remove-model", async (_event, modelId?: string) => {
    await removeLocalModelAndStopSidecar(modelId);
  });

  ipcMain.handle("stt:cancel-install", (_event, modelId?: string) =>
    cancelInstall(modelId),
  );

  ipcMain.handle("stt:cancel-local-transcription", () => {
    localStreams.cancel();
  });

  ipcMain.handle("stt:start-local-stream", (event, modelId: string) =>
    localStreams.start(event.sender, modelId),
  );

  ipcMain.handle(
    "stt:push-local-stream",
    async (
      event,
      sessionId: string,
      pcmBytes: Uint8Array | ArrayBuffer,
    ) => {
      await localStreams.push(event.sender, sessionId, pcmBytes);
    },
  );

  ipcMain.handle("stt:finish-local-stream", (event, sessionId: string) =>
    localStreams.finish(event.sender, sessionId),
  );

  ipcMain.handle(
    "stt:transcribe-local",
    async (
      _event,
      modelId: string,
      pcmBuffer: Uint8Array | ArrayBuffer,
      prompt?: string,
    ) => {
      try {
        // Wrap the IPC payload in place instead of copying it: the sidecar
        // only reads this buffer, and the renderer does not reuse it after the
        // request returns.
        const bytes =
          pcmBuffer instanceof Uint8Array
            ? pcmBuffer
            : new Uint8Array(pcmBuffer);
        return await transcribeWithLocalSidecar(
          modelId,
          Buffer.from(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength,
          ),
          prompt,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[STT] transcribe-local failed:", msg);
        throw err;
      }
    },
  );
}
