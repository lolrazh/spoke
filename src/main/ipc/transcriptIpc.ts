/**
 * Transcript IPC
 *
 * Paste-at-cursor orchestration plus transcription history CRUD handlers
 * backed by lib/transcriptionStorage.
 */

import {
  clipboard,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";

import {
  getTranscriptions,
  getTranscriptionsPage,
  saveTranscription,
  deleteTranscription,
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
    "transcriptions:get-page",
    (_event, payload?: { offset?: number; limit?: number }) => {
      return bootTimeline.measureSync("ipc:transcriptions:get-page", () =>
        getTranscriptionsPage(payload?.offset, payload?.limit),
      );
    },
  );

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

}
