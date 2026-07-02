/**
 * Paste Daemon
 *
 * Manages a pre-spawned native helper process in paste-daemon mode.
 * The daemon stays alive between dictations, receiving "paste\n" commands
 * via stdin and responding with "paste-done" when Cmd+V is complete.
 * This eliminates per-paste spawn latency (~200ms → ~20ms).
 */

import * as fs from "fs";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { getHelperPath } from "./helperPaths";

// ── Internal state ─────────────────────────────────────────────────────

let preSpawnedHelper: ChildProcess | null = null;
let readyPromise: Promise<void> | null = null;
let resolveReady: (() => void) | null = null;

// ── Lifecycle ──────────────────────────────────────────────────────────

export function preSpawnPasteHelper(): void {
  // Clean up any existing pre-spawned helper
  if (preSpawnedHelper && !preSpawnedHelper.killed) {
    try {
      preSpawnedHelper.kill();
    } catch {
      // ignore
    }
    preSpawnedHelper = null;
    readyPromise = null;
    resolveReady = null;
  }

  const helperPath = getHelperPath();
  if (!fs.existsSync(helperPath)) {
    console.error(
      `[PreSpawn] Paste helper binary not found at path: ${helperPath}`,
    );
    return;
  }

  console.log(`[PreSpawn] Starting paste helper daemon for dictation`);

  preSpawnedHelper = spawn(helperPath, ["--mode=paste-daemon"], {
    stdio: "pipe",
    detached: false,
  });

  readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  try {
    preSpawnedHelper.stdout.setEncoding("utf8");
    const onData = (data: string | Buffer) => {
      const out = data.toString().trim();
      if (out.includes("paste-daemon-ready") && resolveReady) {
        resolveReady();
        resolveReady = null;
      }
    };
    preSpawnedHelper.stdout.on("data", onData);
    preSpawnedHelper.once("exit", () => {
      try {
        preSpawnedHelper?.stdout?.off("data", onData as any);
      } catch {}
    });
  } catch {}

  preSpawnedHelper.once("exit", () => {
    preSpawnedHelper = null;
    readyPromise = null;
    resolveReady = null;
  });
}

/** Returns the pre-spawned helper if alive, or null */
export function getPreSpawnedHelper(): ChildProcess | null {
  if (preSpawnedHelper && !preSpawnedHelper.killed) {
    return preSpawnedHelper;
  }
  return null;
}

/** Wait for the daemon to signal readiness (with timeout) */
export async function waitForReady(timeoutMs = 300): Promise<void> {
  if (!readyPromise) return;
  try {
    await Promise.race([
      readyPromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {}
}

/**
 * Send a paste command to the daemon and wait for completion.
 * Returns true if the daemon handled it, false if unavailable.
 */
export async function pasteViaDaemon(): Promise<boolean> {
  const helper = getPreSpawnedHelper();
  if (!helper) return false;

  await waitForReady();
  helper.stdin?.write("paste\n");

  await new Promise<void>((resolve) => {
    const onData = (data: Buffer) => {
      const output = data.toString().trim();
      if (output === "paste-done") {
        helper.stdout?.off("data", onData);
        console.log(`[PasteHelper] Pre-spawned helper completed paste`);
        resolve();
      }
    };
    helper.stdout?.on("data", onData);

    setTimeout(() => {
      helper.stdout?.off("data", onData);
      console.log(`[PasteHelper] Pre-spawned helper timeout, assuming success`);
      resolve();
    }, 1000);
  });

  return true;
}

/** Kill the daemon and clean up state */
export function killPasteDaemon(): void {
  if (preSpawnedHelper && !preSpawnedHelper.killed) {
    const helper = preSpawnedHelper;
    try {
      helper.stdin?.write("exit\n");
    } catch {}

    // Don't trust "exit\n" alone: if the daemon hasn't exited within a
    // grace period, force-kill it so we never leave an orphan behind.
    const forceKillTimer = setTimeout(() => {
      try {
        if (!helper.killed) {
          console.warn(
            "[PasteDaemon] Daemon did not exit after 'exit' command, sending SIGKILL",
          );
          helper.kill("SIGKILL");
        }
      } catch {}
    }, 1500);
    forceKillTimer.unref?.();
    helper.once("exit", () => clearTimeout(forceKillTimer));

    preSpawnedHelper = null;
  }
  readyPromise = null;
  resolveReady = null;
}

/** Respawn the daemon (for post-permission-grant refresh) */
export function respawnPasteDaemon(): void {
  killPasteDaemon();
  preSpawnPasteHelper();
}
