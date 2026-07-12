/**
 * Transcript IPC
 *
 * Paste-at-cursor orchestration plus the last-transcript broadcast and the
 * transcription history CRUD handlers backed by lib/transcriptionStorage.
 */

import {
  BrowserWindow,
  clipboard,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";

import {
  getTranscriptions,
  saveTranscription,
  deleteTranscription,
  clearTranscriptions,
} from "../../lib/transcriptionStorage";
import { bootTimeline } from "../bootTimeline";
import { insertTextAtCursor } from "../pasteOrchestrator";
import { saveAppPreferences } from "../preferences";
import {
  addVocabularyEntry,
  getVocabularyDictionary,
  removeVocabularyEntry,
  updateVocabularyEntry,
} from "../vocabularyService";
import { state } from "../windowState";

// Registered at module load (not inside app.whenReady()), matching the
// original main.ts evaluation order.
export function registerInsertTextAtCursorIpc(): void {
  ipcMain.handle(
    "insert-text-at-cursor",
    async (_event: IpcMainInvokeEvent, text: string) => {
      return insertTextAtCursor(text);
    },
  );
}

export function registerTranscriptIpc(): void {
  ipcMain.handle("clipboard:write-text", (_event, text: string) => {
    try {
      clipboard.writeText(typeof text === "string" ? text : String(text ?? ""));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  // Handle last transcript updates from renderer
  ipcMain.on("transcript:update", (_event, text: string) => {
    console.log(`[IPC] Received transcript update (${text.length} chars)`);
    state.lastTranscript = text;
    BrowserWindow.getAllWindows().forEach((window) => {
      try {
        window.webContents.send("transcript:updated", text);
      } catch {}
    });
  });

  // Auto-space preference (trailing space appended after inserted dictation)
  ipcMain.handle("auto-space:get-enabled", () => {
    return { enabled: state.appPreferences.autoSpace ?? true };
  });

  ipcMain.handle(
    "auto-space:set-enabled",
    (_event, payload: { enabled: boolean }) => {
      try {
        state.appPreferences.autoSpace = payload.enabled;
        saveAppPreferences(state.appPreferences);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  // Vocabulary dictionary (words/phrases used to correct transcripts)
  ipcMain.handle("vocabulary:get-dictionary", () => {
    return { dictionary: getVocabularyDictionary() };
  });

  ipcMain.handle(
    "vocabulary:add-entry",
    (_event, payload: { value: unknown }) => addVocabularyEntry(payload?.value),
  );
  ipcMain.handle(
    "vocabulary:update-entry",
    (_event, payload: { currentValue: unknown; nextValue: unknown }) =>
      updateVocabularyEntry(payload?.currentValue, payload?.nextValue),
  );
  ipcMain.handle(
    "vocabulary:remove-entry",
    (_event, payload: { value: unknown }) =>
      removeVocabularyEntry(payload?.value),
  );

  // Transcription history storage handlers
  ipcMain.handle("transcriptions:get-all", () => {
    return bootTimeline.measureSync("ipc:transcriptions:get-all", () =>
      getTranscriptions(),
    );
  });

  ipcMain.handle(
    "transcriptions:save",
    (
      _event,
      payload: { text: string; timestamp: number; mode: "dictation" | "edit" },
    ) => {
      return saveTranscription(payload);
    },
  );

  ipcMain.handle("transcriptions:delete", (_event, payload: { id: string }) => {
    return deleteTranscription(payload.id);
  });

  ipcMain.handle("transcriptions:clear", () => {
    clearTranscriptions();
    return { ok: true };
  });
}
