/**
 * Fn/PTT Listener
 *
 * Manages the native "Spoke Helper" child process that reports Right
 * Option/Command key state over stdout, translating its line-based protocol
 * into `ptt-*` IPC events sent to whichever window currently owns PTT focus
 * (main pill window vs. onboarding). Also owns the crash/backoff restart
 * logic and an Input Monitoring preflight check used before first start.
 */

import type { BrowserWindow } from "electron";
import { spawn } from "child_process";
import fs from "node:fs";

import { getHelperPath } from "./helperPaths";
import { bootTimeline } from "./bootTimeline";
import { spawnHelper } from "./helperProcess";
import { preSpawnPasteHelper, killPasteDaemon } from "./pasteDaemon";
import { state } from "./windowState";

// ── Internal state ─────────────────────────────────────────────────────

let fnProc: import("child_process").ChildProcessWithoutNullStreams | null =
  null;
let fnRestartTimeout: NodeJS.Timeout | null = null;
let fnPermissionDenied = false;
let fnStdoutBuffer = ""; // Buffer for incomplete lines from spoke-helper stdout

// ── Shutdown helper ────────────────────────────────────────────────────

/** Clears any pending restart timer. Called during app shutdown. */
export function clearFnRestartTimer(): void {
  if (fnRestartTimeout) {
    clearTimeout(fnRestartTimeout);
    fnRestartTimeout = null;
  }
}

// ── Input Monitoring preflight ─────────────────────────────────────────

export async function startHelperIfIMGranted(): Promise<void> {
  try {
    bootTimeline.mark("helper:im-preflight:start");
    const helperPath = getHelperPath();
    if (!fs.existsSync(helperPath)) {
      console.warn("[FnListener] Helper not found; cannot preflight IM grant");
      bootTimeline.mark("helper:im-preflight:missing");
      return;
    }
    await new Promise<void>((resolve) => {
      const proc = spawn(helperPath, ["--check-permissions"], {
        stdio: ["ignore", "pipe", "ignore"],
        detached: false,
      });
      let out = "";
      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.on("error", (err) => {
        console.error("[FnListener] Helper spawn error:", err);
        resolve();
      });
      proc.on("close", () => {
        const hasIM = out.includes("im-granted");
        bootTimeline.mark("helper:im-preflight:done", { hasIM });
        if (hasIM) {
          try {
            startFnListener();
          } catch {}
        } else {
          console.log("[FnListener] IM not granted; helper start deferred");
        }
        resolve();
      });
    });
  } catch (e) {
    console.warn(
      "[FnListener] Preflight IM check failed:",
      (e as Error)?.message,
    );
  }
}

export function startFnListener() {
  bootTimeline.mark("helper:start-listener");
  // Clear any pending restart timer and reset permission flag
  if (fnRestartTimeout) {
    clearTimeout(fnRestartTimeout);
    fnRestartTimeout = null;
  }

  // Reset permission denied flag when explicitly starting listener
  // (e.g., on app startup or manual restart)
  fnPermissionDenied = false;

  // Clear any buffered stdout data from previous process
  fnStdoutBuffer = "";

  // Clean up existing process to prevent orphaned processes
  if (fnProc && !fnProc.killed) {
    console.log(
      "[FnListener] Cleaning up existing spoke-helper process before starting new one",
    );
    try {
      fnProc.kill("SIGTERM");
    } catch (error) {
      console.warn(
        "[FnListener] Error killing existing spoke-helper process:",
        error,
      );
    }
    fnProc = null;
  }

  const helperPath = getHelperPath();

  // Check if the helper binary exists before attempting to spawn
  if (!fs.existsSync(helperPath)) {
    console.error(
      `[FnListener] Spoke Helper binary not found at path: ${helperPath}`,
    );

    const targetWindow = state.mainWindow || state.onboardingWindow;
    targetWindow?.webContents.send(
      "notify",
      "Hotkey detection unavailable: binary missing",
    );
    return;
  }

  try {
    console.log(
      `[FnListener] Starting Spoke Helper helper from: ${helperPath}`,
    );
    fnProc = spawnHelper(
      helperPath,
      [],
      true,
    ) as import("child_process").ChildProcessWithoutNullStreams;

    fnProc.stdout.setEncoding("utf8");
    fnProc.stdout.on("data", (chunk: string) => {
      // Append chunk to buffer to handle commands split across boundaries
      fnStdoutBuffer += chunk;

      // Process complete lines
      const lines = fnStdoutBuffer.split(/\r?\n/);

      // Keep the last (potentially incomplete) line in the buffer
      fnStdoutBuffer = lines.pop() || "";

      // Process complete lines
      lines.forEach((line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return; // Skip empty lines

        console.log(`[FnListener] Received command: "${trimmedLine}"`);
        if (trimmedLine === "ready") {
          bootTimeline.mark("helper:ready");
        }

        let targetWindow: BrowserWindow | null = null;
        if (state.pttTarget === "onboarding")
          targetWindow = state.onboardingWindow || state.mainWindow;
        else if (state.pttTarget === "main")
          targetWindow = state.mainWindow || state.onboardingWindow;
        else targetWindow = state.onboardingWindow || state.mainWindow;
        const mirrorWindow =
          targetWindow === state.mainWindow
            ? state.onboardingWindow
            : state.mainWindow;
        if (trimmedLine === "ready") {
          // Signal to both windows that PTT is ready
          state.onboardingWindow?.webContents.send("ptt-ready");
          state.mainWindow?.webContents.send("ptt-ready");
          // Ignore legacy generic and Fn events; only handle Right Option/Command
        } else if (trimmedLine === "optR-down") {
          // Right Option: primary PTT hotkey (press-and-hold)
          preSpawnPasteHelper();
          targetWindow?.webContents.send("ptt-down");
          if (
            state.pttTarget === "main" &&
            mirrorWindow &&
            mirrorWindow !== targetWindow
          )
            mirrorWindow.webContents.send("ptt-down");
        } else if (trimmedLine === "optR-up") {
          // End of PTT press-and-hold
          killPasteDaemon();
          targetWindow?.webContents.send("ptt-up");
          if (
            state.pttTarget === "main" &&
            mirrorWindow &&
            mirrorWindow !== targetWindow
          )
            mirrorWindow.webContents.send("ptt-up");
        } else if (trimmedLine === "cmdR-down") {
          // Right Command: visual press state only
          targetWindow?.webContents.send("ptt-cancel-down");
          if (
            state.pttTarget === "main" &&
            mirrorWindow &&
            mirrorWindow !== targetWindow
          )
            mirrorWindow.webContents.send("ptt-cancel-down");
        } else if (trimmedLine === "cmdR-up") {
          // Right Command: trigger cancel on release
          targetWindow?.webContents.send("ptt-cancel");
          if (
            state.pttTarget === "main" &&
            mirrorWindow &&
            mirrorWindow !== targetWindow
          )
            mirrorWindow.webContents.send("ptt-cancel");
        } else if (
          trimmedLine === "optL-down" ||
          trimmedLine === "optL-up" ||
          trimmedLine === "cmdL-down" ||
          trimmedLine === "cmdL-up"
        ) {
          // Ignore left-side modifiers explicitly
        } else if (trimmedLine === "perm-denied") {
          fnPermissionDenied = true;

          // Show tray notification immediately
          targetWindow?.webContents.send(
            "notify",
            "Grant Input Monitoring permission → restart",
          );
          // Do not show modal dialogs automatically; rely on pill notification UX
        } else {
          // Ignore any other helper messages silently
        }
      });
    });

    fnProc.stderr?.on("data", (chunk: string) => {
      console.error(`[FnListener] Spoke Helper stderr: ${chunk.toString()}`);
    });

    fnProc.on("error", (error: Error) => {
      console.error(
        "[FnListener] Failed to start Spoke Helper helper process:",
        error,
      );
      fnProc = null;

      const targetWindow =
        state.pttTarget === "main"
          ? state.mainWindow || state.onboardingWindow
          : state.onboardingWindow || state.mainWindow;
      if (error.message.includes("ENOENT")) {
        console.error(
          "[FnListener] Spoke Helper binary not found or not executable",
        );
        targetWindow?.webContents.send(
          "notify",
          "Hotkey detection unavailable: binary not found",
        );
      } else if (error.message.includes("EACCES")) {
        console.error(
          "[FnListener] Spoke Helper binary lacks execution permissions",
        );
        targetWindow?.webContents.send(
          "notify",
          "Hotkey detection unavailable: permission denied",
        );
      } else {
        console.error(
          "[FnListener] Unknown error starting Spoke Helper:",
          error.message,
        );
        (state.pttTarget === "main"
          ? state.mainWindow || state.onboardingWindow
          : state.onboardingWindow || state.mainWindow
        )?.webContents.send(
          "notify",
          "Hotkey detection unavailable: startup error",
        );
      }

      // Schedule restart only if not already scheduled and not quitting
      scheduleRestart("error");
    });

    fnProc.on("close", (code, signal) => {
      console.log(
        `[FnListener] Spoke Helper helper process closed with code ${code}, signal ${signal}`,
      );
      fnProc = null;

      // Schedule restart only if not already scheduled and not quitting
      scheduleRestart("close");
    });

    fnProc.on("exit", (code, signal) => {
      console.log(
        `[FnListener] Spoke Helper helper process exited with code ${code}, signal ${signal}`,
      );
    });
  } catch (error) {
    console.error(
      "[FnListener] Exception when spawning Spoke Helper helper:",
      error,
    );
    fnProc = null;

    const targetWindow =
      state.pttTarget === "main"
        ? state.mainWindow || state.onboardingWindow
        : state.onboardingWindow || state.mainWindow;
    targetWindow?.webContents.send(
      "notify",
      "Hotkey detection unavailable: spawn failed",
    );

    // Schedule restart only if not already scheduled and not quitting
    scheduleRestart("exception");
  }
}

function scheduleRestart(reason: string) {
  // Don't restart if already scheduled, if quitting, or if permissions were denied
  if (fnRestartTimeout || state.isQuitting || fnPermissionDenied) {
    if (fnPermissionDenied) {
      console.log(
        "[FnListener] Not scheduling restart due to permission denial. User must restart app after granting permissions.",
      );
      return;
    }
    console.log(
      `[FnListener] Not scheduling restart: already scheduled=${!!fnRestartTimeout}, quitting=${state.isQuitting}`,
    );
    return;
  }

  // Only auto-restart on crashes, not permission denials
  const delayMs = reason === "close" ? 5000 : 10000;
  console.log(
    `[FnListener] Scheduling restart in ${delayMs / 1000}s due to ${reason}...`,
  );

  fnRestartTimeout = setTimeout(() => {
    fnRestartTimeout = null;
    if (!fnPermissionDenied && !state.isQuitting) {
      console.log(`[FnListener] Executing scheduled restart due to ${reason}`);
      startFnListener();
    } else {
      console.log(
        `[FnListener] Skipping scheduled restart: permissions denied=${fnPermissionDenied}, quitting=${state.isQuitting}`,
      );
    }
  }, delayMs);
}
