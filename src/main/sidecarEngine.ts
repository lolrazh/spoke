/**
 * Sidecar Engine
 *
 * Manages the local STT Python sidecar process lifecycle and transcription.
 * Handles spawning, readiness detection, graceful shutdown, and serialized
 * transcription requests via length-prefixed PCM over stdin/stdout.
 */

import * as fs from "fs";
import { spawn } from "child_process";
import type { SttEvent, LocalTranscribeResult } from "../types/shared";
import { getSidecarBinaryPath, getSidecarArgs } from "./sidecarPaths";

// ── Internal state ─────────────────────────────────────────────────────

let sidecarProcess: ReturnType<typeof spawn> | null = null;
let sidecarReady = false;
let sidecarTranscribeQueue: Promise<void> = Promise.resolve();
let autoRestartEnabled = false;

// ── Lifecycle ──────────────────────────────────────────────────────────

export function isSidecarRunning(): boolean {
  return sidecarProcess !== null && sidecarReady;
}

export function setAutoRestart(enabled: boolean): void {
  autoRestartEnabled = enabled;
}

export function spawnSidecar(): Promise<void> {
  return new Promise((resolve, reject) => {
    const binaryPath = getSidecarBinaryPath();
    const args = getSidecarArgs();

    if (!fs.existsSync(binaryPath)) {
      reject(
        new Error(
          `Local STT binary not found at ${binaryPath}. In dev, run: cd local-stt && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`,
        ),
      );
      return;
    }

    console.log(
      `[STT] Spawning sidecar daemon: ${binaryPath} ${args.join(" ")}`,
    );
    const proc = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });

    sidecarProcess = proc;
    sidecarReady = false;

    // Timeout if model takes too long to load (30s)
    const timeout = setTimeout(() => {
      console.error("[STT] Sidecar timed out waiting for ready signal");
      killSidecar();
      reject(new Error("Sidecar timed out loading model"));
    }, 30000);

    let stdoutBuffer = "";
    const onData = (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "ready") {
            clearTimeout(timeout);
            sidecarReady = true;
            console.log("[STT] Sidecar daemon ready");
            // Remove this listener — ongoing stdout parsing is per-request
            proc.stdout?.removeListener("data", onData);
            resolve();
          }
        } catch {
          console.warn("[STT] Non-JSON stdout during init:", line);
        }
      }
    };

    proc.stdout?.on("data", onData);

    proc.stderr?.on("data", (data: Buffer) => {
      console.log("[STT/stderr]", data.toString().trimEnd());
    });

    proc.once("exit", (code) => {
      console.log(`[STT] Sidecar exited with code ${code}`);
      clearTimeout(timeout);
      sidecarProcess = null;
      sidecarReady = false;

      // Auto-restart on unexpected exit (one attempt)
      if (autoRestartEnabled && code !== 0) {
        console.log(
          "[STT] Sidecar exited unexpectedly, attempting restart in 2s...",
        );
        setTimeout(() => {
          if (autoRestartEnabled && !sidecarProcess) {
            spawnSidecar().catch((err) => {
              console.error("[STT] Auto-restart failed:", err);
            });
          }
        }, 2000);
      }
    });

    proc.once("error", (err) => {
      console.error("[STT] Sidecar spawn error:", err);
      clearTimeout(timeout);
      sidecarProcess = null;
      sidecarReady = false;
      reject(err);
    });
  });
}

export function killSidecar(): void {
  autoRestartEnabled = false;
  if (!sidecarProcess) return;
  console.log("[STT] Killing sidecar daemon...");
  try {
    // Send zero-length message to signal graceful exit
    const zeroBuf = Buffer.alloc(4);
    zeroBuf.writeUInt32LE(0);
    sidecarProcess.stdin?.write(zeroBuf);
  } catch {
    // ignore write errors
  }
  // Force kill after a brief grace period
  const proc = sidecarProcess;
  setTimeout(() => {
    try {
      if (proc && !proc.killed && proc.pid) {
        process.kill(proc.pid, "SIGKILL");
      }
    } catch {
      // ignore
    }
  }, 2000);
  sidecarProcess = null;
  sidecarReady = false;
}

// ── Transcription ──────────────────────────────────────────────────────

export function transcribeLocal(
  pcmBuffer: Buffer,
): Promise<LocalTranscribeResult> {
  // Sidecar stdout is a shared stream. Serialize requests so "done" events
  // cannot be consumed by the wrong in-flight caller.
  const queued = sidecarTranscribeQueue.then(
    () => transcribeLocalOnce(pcmBuffer),
    () => transcribeLocalOnce(pcmBuffer),
  );
  sidecarTranscribeQueue = queued.then(
    (): undefined => undefined,
    (): undefined => undefined,
  );
  return queued;
}

function transcribeLocalOnce(
  pcmBuffer: Buffer,
): Promise<LocalTranscribeResult> {
  return new Promise((resolve, reject) => {
    if (!sidecarProcess || !sidecarReady) {
      reject(new Error("Sidecar not running"));
      return;
    }

    const proc = sidecarProcess;
    let stdoutBuffer = "";
    let resolved = false;
    let timeout: NodeJS.Timeout | null = null;

    const onData = (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event: SttEvent = JSON.parse(line);
          if (event.type === "done") {
            resolved = true;
            cleanup();
            resolve({ text: event.transcript, metrics: event.metrics });
            return;
          }
          // partials are ignored for now (no streaming UI in local mode)
        } catch {
          console.warn("[STT] Non-JSON stdout:", line);
        }
      }
    };

    const onExit = () => {
      if (!resolved) {
        cleanup();
        reject(new Error("Sidecar exited during transcription"));
      }
    };

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      proc.stdout?.removeListener("data", onData);
      proc.removeListener("exit", onExit);
    };

    proc.stdout?.on("data", onData);

    // Timeout after 60s
    timeout = setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error("Local transcription timed out"));
      }
    }, 60000);

    proc.once("exit", onExit);

    // Write length-prefixed PCM to stdin
    try {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(pcmBuffer.length);
      proc.stdin?.write(lenBuf);
      proc.stdin?.write(pcmBuffer);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}
