/** Serialize context, clipboard, and paste so concurrent requests cannot mix text. */
import { clipboard } from "electron";
import { performance } from "node:perf_hooks";
import { insertViaPasteDaemon } from "./pasteDaemon";
import { formatDictationForInsertion } from "./contextualDictationFormatter";
import { inspectFocusedSelection } from "./selectionInspect";
import { state } from "./windowState";

export interface InsertTextAtCursorResult {
  success: boolean;
  error?: string;
  verified?: boolean;
}
const INSERTION_CONTEXT_CHARS = 96;
let insertionTail: Promise<unknown> = Promise.resolve();

export function insertTextAtCursor(
  text: string,
): Promise<InsertTextAtCursorResult> {
  const insertion = insertionTail.then(() => performInsertion(text));
  insertionTail = insertion.catch(() => undefined);
  return insertion;
}

async function performInsertion(
  text: string,
): Promise<InsertTextAtCursorResult> {
  if (typeof text !== "string" || !text)
    return { success: false, error: "Cannot insert empty text." };
  const started = performance.now();
  let contextDone: number | null = null,
    handoffDone: number | null = null,
    dispatchDone: number | null = null;
  let method = "none";
  let clipboardMs: number | null = null,
    dispatchMs: number | null = null;
  let payload = text;
  try {
    const selection = await inspectFocusedSelection({
      contextChars: INSERTION_CONTEXT_CHARS,
      passive: true,
    });
    payload = formatDictationForInsertion(text, {
      autoSpace: state.appPreferences.autoSpace ?? true,
      dictionary: state.appPreferences.vocabularyDictionary ?? [],
      selection,
      contextChars: INSERTION_CONTEXT_CHARS,
    });
    contextDone = performance.now();
    if (!selection.targetPid)
      throw new Error(`Paste target is unavailable (${selection.status}).`);
    method = "targeted-cmd-v";
    const receipt = await insertViaPasteDaemon(payload, selection.targetPid);
    handoffDone = performance.now();
    clipboardMs = receipt.clipboardMs;
    dispatchMs = receipt.dispatchMs;
    dispatchDone = handoffDone;
    const restoreClipboard = receipt.restoreClipboard;
    // Do not await restoration, and never overwrite a newer clipboard value.
    const timer = setTimeout(() => {
      void restoreClipboard().catch((error) =>
        console.warn("[Paste] Clipboard restore failed:", error),
      );
    }, 300);
    timer.unref?.();
    return { success: true, verified: false };
  } catch (error) {
    // Never retry a dispatched paste: the target may have received it even
    // when the helper did not ACK. Keep a manual paste available instead.
    console.warn("[Paste] Insertion failed:", error);
    try {
      clipboard.writeText(payload);
    } catch {
      /* original clipboard retained */
    }
    state.mainWindow?.webContents.send(
      "notify",
      "Paste failed. Text copied to clipboard.",
    );
    return {
      success: false,
      verified: false,
      error: error instanceof Error ? error.message : "Text insertion failed.",
    };
  } finally {
    console.info("[Latency] Text insertion", {
      context_ms:
        contextDone === null
          ? null
          : Math.round((contextDone - started) * 1000) / 1000,
      // Native phase times exclude the pipe handoff; handoff_ms includes it.
      clipboard_ms: clipboardMs,
      dispatch_ms: dispatchMs,
      handoff_ms:
        handoffDone === null || contextDone === null
          ? null
          : Math.round((handoffDone - contextDone) * 1000) / 1000,
      total_ms: Math.round((performance.now() - started) * 1000) / 1000,
      method,
      completion: dispatchDone === null ? "failed" : "events-posted",
    });
  }
}

export async function pasteLastTranscript(): Promise<void> {
  if (state.lastTranscript?.trim())
    await insertTextAtCursor(state.lastTranscript);
}
