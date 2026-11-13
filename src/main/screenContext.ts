import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { getHelperPath } from "./helperPaths";
import { screenContextSession } from "./screenContextSession";
import { contextDictionary, clearContextVocabulary } from "./contextVocabulary";
import { contextDebugEnabled, recordContextDebug, recordNativeContextDebug } from "./contextDebug";

let child: ChildProcessWithoutNullStreams | null = null;
let deadline: ReturnType<typeof setTimeout> | undefined;
let pendingId: string | null = null;
let retryAfter = 0;
// Allow cold native initialization while the user is still speaking. Speech
// stop freezes ready terms immediately; this budget never extends paste time.
const DEADLINE_MS = 8000;

export function stopScreenContext(): void {
  clearContextVocabulary();
  screenContextSession.clear();
  clearTimeout(deadline);
  const previous = child;
  child = null;
  pendingId = null;
  previous?.kill("SIGKILL");
}

// Keep one idle worker while enabled. Cancel stops screen watching; retaining
// the process avoids repeating macOS capture startup after each short pause.
export function prewarmScreenContext(): void {
  startWorker(true);
}

function startWorker(warmVision: boolean): void {
  if (child || process.platform !== "darwin") return;
  // A broken helper must not enter a restart loop on each key event.
  if (Date.now() < retryAfter) return;
  const path = getHelperPath();
  if (!existsSync(path)) return;
  const worker = spawn(path, ["--mode=context-daemon"], { stdio: "pipe" });
  worker.stderr.resume();
  child = worker;
  let buffer = "";
  worker.stdout.setEncoding("utf8");
  worker.stdout.on("data", (chunk: string) => {
    if (child !== worker) return;
    buffer += chunk;
    if (buffer.length > 4_200_000) { stopScreenContext(); return; }
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const result = JSON.parse(line);
        if (result.event === "debug-stage") { recordContextDebug(result.id, "capture-stage", { stage: result.stage, nativeMs: result.ms }); continue; }
        if (result.event === "debug") { recordNativeContextDebug(result.id, result); continue; }
        recordContextDebug(result.id, "capture-result", { source: result.source, status: result.status, nativeMs: result.ms, terms: result.terms });
        if (result.status === "target-changed") {
          screenContextSession.invalidate(result.id);
          clearContextVocabulary();
        }
        if (result.id !== pendingId) continue;
        // A quick Accessibility result can arrive before the full-window OCR.
        // Keep the deadline until the final result; never wait at speech stop.
        if (result.status !== "partial") {
          clearTimeout(deadline);
          pendingId = null;
        }
        const accepted = screenContextSession.accept(result.id, result.terms);
        recordContextDebug(result.id, "context-acceptance", { accepted, terms: screenContextSession.read(result.id) });
        if (accepted) contextDictionary(result.id);
        // Never log pixels, screen text, window titles, or the extracted terms.
        console.info("[Context] Local capture", {
          source: result.source, status: result.status, ms: result.ms,
          terms: Array.isArray(result.terms) ? result.terms.length : 0, accepted,
        });
      } catch { /* Ignore non-protocol startup output. */ }
    }
  });
  const failed = () => {
    if (child !== worker) return;
    retryAfter = Date.now() + 5000;
    stopScreenContext();
  };
  worker.stdin.on("error", failed);
  worker.on("error", failed);
  worker.on("exit", failed);
  // Idle preparation reads no screen. An on-demand capture must not queue
  // behind a synthetic OCR job, especially when Accessibility is sufficient.
  if (warmVision) worker.stdin.write('{"command":"warm"}\n');
}

export function beginScreenContext(id: string): void {
  clearTimeout(deadline);
  // Supersede blocked capture rather than queue work from a previous utterance.
  if (pendingId) stopScreenContext();
  clearContextVocabulary();
  screenContextSession.begin(id);
  startWorker(false);
  if (!child) { recordContextDebug(id, "capture-unavailable", {}); return; }
  pendingId = id;
  child.stdin.write(JSON.stringify({ command: "capture", id, debug: contextDebugEnabled(id) }) + "\n");
  deadline = setTimeout(() => {
    recordContextDebug(id, "capture-timeout", { deadlineMs: DEADLINE_MS });
    screenContextSession.freeze(id);
    stopScreenContext();
  }, DEADLINE_MS);
  deadline.unref?.();
}

export function freezeScreenContext(id: string): void {
  if (!screenContextSession.owns(id)) return;
  recordContextDebug(id, "speech-stopped", { termsReady: screenContextSession.read(id) });
  screenContextSession.freeze(id);
}

export function endScreenContext(id: string): void {
  if (!screenContextSession.owns(id)) return;
  screenContextSession.end(id);
  clearContextVocabulary();
  child?.stdin.write(JSON.stringify({ command: "cancel", id }) + "\n");
  if (pendingId === id) { stopScreenContext(); startWorker(true); }
}
