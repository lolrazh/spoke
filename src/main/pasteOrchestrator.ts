/**
 * Paste Orchestrator
 *
 * Shared logic for injecting transcribed text at the OS cursor: puts the
 * text on the clipboard, triggers the native paste helper (preferring the
 * pre-spawned daemon, falling back to a direct spawn), and restores the
 * user's original clipboard contents shortly after — but only if nothing
 * else has since overwritten the clipboard.
 */

import { clipboard } from "electron";
import fs from "node:fs";

import { getHelperPath } from "./helperPaths";
import { spawnHelper } from "./helperProcess";
import { pasteViaDaemon } from "./pasteDaemon";
import {
  applyAutoSpace,
  formatDictationForInsertion,
} from "./contextualDictationFormatter";
import { inspectFocusedSelection } from "./selectionInspect";
import { state } from "./windowState";

export interface InsertTextAtCursorResult {
  success: boolean;
  error?: string;
  verified?: boolean;
}

export { applyAutoSpace };

const INSERTION_CONTEXT_CHARS = 96;

async function buildInsertionPayload(text: string): Promise<string> {
  const autoSpace = state.appPreferences.autoSpace ?? true;
  const dictionary = state.appPreferences.vocabularyDictionary ?? [];

  try {
    const selection = await inspectFocusedSelection({
      contextChars: INSERTION_CONTEXT_CHARS,
    });
    return formatDictationForInsertion(text, {
      autoSpace,
      dictionary,
      selection,
      contextChars: INSERTION_CONTEXT_CHARS,
    });
  } catch (error) {
    console.warn("[PasteHelper] Context inspection failed:", error);
    return formatDictationForInsertion(text, { autoSpace, dictionary });
  }
}

// Add a handler for insert-text-at-cursor
export async function insertTextAtCursor(
  text: string,
): Promise<InsertTextAtCursorResult> {
  if (!text) {
    console.warn("[PasteHelper] Received empty text. Aborting insertion.");
    return { success: false, error: "Cannot insert empty text." };
  }

  try {
    console.log("=== TEXT INSERTION PROCESS START ===");
    console.log(`Received text (${text.length} chars)`);

    const originalClipboardText = clipboard.readText();
    console.log("Original clipboard text stored.");

    const payloadText = await buildInsertionPayload(text);
    clipboard.writeText(payloadText);
    console.log("Transcription text copied to clipboard for pasting.");

    const helperPath = getHelperPath();
    if (!fs.existsSync(helperPath)) {
      console.error(
        `[PasteHelper] Spoke Helper binary not found at path: ${helperPath}`,
      );
      state.mainWindow?.webContents.send(
        "notify",
        "Paste unavailable: binary missing. Copied to clipboard.",
      );
      return { success: false, error: "Paste helper binary not found." };
    }

    // Use pre-spawned daemon if available, otherwise fallback to direct spawn
    const pastedViaDaemon = await pasteViaDaemon();
    if (!pastedViaDaemon) {
      console.log(
        `[PasteHelper] Pre-spawn not available, using direct spawn from: ${helperPath}`,
      );
      const proc = spawnHelper(helperPath, ["--mode=paste"], false);

      await new Promise<void>((resolve) => {
        let stderrBuffer = "";
        proc.stderr?.on("data", (data) => {
          stderrBuffer += data.toString();
        });
        proc.on("close", (code) => {
          if (stderrBuffer)
            console.error(`[PasteHelper stderr]: ${stderrBuffer.trim()}`);
          console.log(
            `[PasteHelper] fallback paste helper exited with code ${code}`,
          );
          resolve();
        });
        proc.on("error", (error) => {
          console.error(
            "[PasteHelper] Error executing fallback paste-helper:",
            error,
          );
          resolve();
        });
      });
    }

    // Restore original clipboard regardless of outcome, but only if the
    // clipboard still holds the text we injected — if the user or another
    // app changed it in the meantime, don't clobber their new contents.
    setTimeout(() => {
      try {
        if (clipboard.readText() === payloadText) {
          clipboard.writeText(originalClipboardText);
        }
      } catch {}
    }, 300);

    console.log("=== TEXT INSERTION PROCESS COMPLETE ===");
    return { success: true, verified: false };
  } catch (error) {
    console.error("=== TEXT INSERTION PROCESS FAILED (Exception) ===");
    console.error("Error during text insertion:", error);
    // In case of any other error, leave the transcribed text in the clipboard.
    try {
      const trimmed = typeof text === "string" ? text.trimStart() : text;
      clipboard.writeText(trimmed as string);
    } catch {
      clipboard.writeText(text);
    }
    state.mainWindow?.webContents.send(
      "notify",
      "Error. Text copied to clipboard.",
    );
    return {
      success: false,
      error:
        "An error occurred during text insertion. Text copied to clipboard.",
    };
  }
}

// Paste the last transcript (used by the global shortcut and tray/context menu items)
export async function pasteLastTranscript() {
  if (!state.lastTranscript || state.lastTranscript.trim().length === 0) {
    console.log("[PasteShortcut] No transcript available to paste");
    return;
  }

  try {
    console.log(
      "[PasteShortcut] Pasting last transcript via Command+Control+V",
    );

    const originalClipboardText = clipboard.readText();
    const payloadText = await buildInsertionPayload(state.lastTranscript);
    clipboard.writeText(payloadText);

    const helperPath = getHelperPath();
    if (!fs.existsSync(helperPath)) {
      console.error("[PasteShortcut] Helper binary not found");
      return;
    }

    // Use pre-spawned daemon or fallback to direct spawn
    const pastedViaDaemon = await pasteViaDaemon();
    if (!pastedViaDaemon) {
      console.log("[PasteShortcut] Using direct spawn");
      const proc = spawnHelper(helperPath, ["--mode=paste"], false);
      await new Promise<void>((resolve) => {
        proc.on("close", () => resolve());
        proc.on("error", () => resolve());
      });
    }

    // Restore original clipboard, but only if it still holds the text we
    // injected — skip if the user or another app changed it meanwhile.
    setTimeout(() => {
      try {
        if (clipboard.readText() === payloadText) {
          clipboard.writeText(originalClipboardText);
        }
      } catch {}
    }, 300);
  } catch (error) {
    console.error("[PasteShortcut] Error pasting transcript:", error);
  }
}
