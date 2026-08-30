/**
 * Sidecar Engine
 *
 * Manages the MLX STT sidecar process lifecycle and transcription. The sidecar
 * is multi-engine; the active model family is selected at spawn time.
 * Handles spawning, readiness detection, graceful shutdown, and serialized
 * transcription requests via length-prefixed PCM over stdin/stdout.
 */

import * as fs from "fs";
import { spawn } from "child_process";
import { StringDecoder } from "node:string_decoder";
import type { SttEvent, LocalTranscribeResult } from "../types/shared";
import { getSidecarBinaryPath, getSidecarArgs } from "./sidecarPaths";
import { getActiveModelId } from "./modelManager";
import { getModelFamily } from "./localModelContract";
import { bootTimeline } from "./bootTimeline";

// 16 kHz, mono, signed PCM16. Keep this below Parakeet's problematic
// full-attention region; renderer chunking normally sends 25-second requests.
export const LOCAL_STT_MAX_REQUEST_BYTES = 30 * 16_000 * 2;
export const LOCAL_STT_MAX_STREAM_FRAME_BYTES = 1 * 16_000 * 2;
export const LOCAL_STT_MAX_STREAM_BYTES = 5 * 60 * 16_000 * 2;

export interface LocalStreamingSession {
  push(pcmBuffer: Buffer): Promise<void>;
  finish(): Promise<LocalTranscribeResult>;
  cancel(): void;
}

// ── Internal state ─────────────────────────────────────────────────────

let sidecarProcess: ReturnType<typeof spawn> | null = null;
let sidecarReady = false;
let sidecarSpawnPromise: Promise<void> | null = null;
let sidecarModelId: string | null = null;
let sidecarTranscribeQueue: Promise<void> = Promise.resolve();
let sidecarGeneration = 0;
let sidecarStoppingPromise: Promise<void> | null = null;
let autoRestartEnabled = false;
const processExitPromises = new WeakMap<object, Promise<void>>();
const exitedProcesses = new WeakSet<object>();

/** Consume complete newline-delimited records without allocating a line array. */
function consumeLines(
  buffer: string,
  onLine: (line: string) => boolean,
): string {
  let lineStart = 0;
  let lineEnd = buffer.indexOf("\n");
  while (lineEnd >= 0) {
    const line = buffer.slice(lineStart, lineEnd);
    lineStart = lineEnd + 1;
    if (line.trim() && !onLine(line)) break;
    lineEnd = buffer.indexOf("\n", lineStart);
  }

  return lineStart === 0 ? buffer : buffer.slice(lineStart);
}

export const SIDECAR_STARTUP_TIMEOUT_MS = 120000;
export const SIDECAR_SHUTDOWN_TIMEOUT_MS = 5000;

// ── Lifecycle ──────────────────────────────────────────────────────────

export function isSidecarRunning(): boolean {
  return sidecarProcess !== null && sidecarReady;
}

export function getSidecarModelId(): string | null {
  return sidecarProcess ? sidecarModelId : null;
}

export function setAutoRestart(enabled: boolean): void {
  autoRestartEnabled = enabled;
}

export function spawnSidecar(modelId = getActiveModelId()): Promise<void> {
  if (sidecarProcess && sidecarReady && sidecarModelId === modelId) {
    return Promise.resolve();
  }
  if (sidecarStoppingPromise) {
    const stopping = sidecarStoppingPromise;
    return stopping.then(() => {
      if (sidecarStoppingPromise === stopping) {
        sidecarStoppingPromise = null;
      }
      return spawnSidecar(modelId);
    });
  }
  if (sidecarSpawnPromise) {
    if (sidecarModelId !== modelId) {
      return Promise.reject(
        new Error(
          `Sidecar for '${sidecarModelId ?? "unknown"}' is still stopping or starting`,
        ),
      );
    }
    return sidecarSpawnPromise;
  }
  if (sidecarProcess) {
    return Promise.reject(
      new Error(
        `Sidecar for '${sidecarModelId ?? "unknown"}' must exit before '${modelId}' can start`,
      ),
    );
  }

  sidecarSpawnPromise = spawnSidecarOnce(modelId).finally(() => {
    sidecarSpawnPromise = null;
  });
  return sidecarSpawnPromise;
}

function spawnSidecarOnce(modelId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const binaryPath = getSidecarBinaryPath();
    const family = getModelFamily(modelId) ?? "whisper";
    const args = getSidecarArgs(family);

    if (!fs.existsSync(binaryPath)) {
      reject(
        new Error(
          `MLX STT sidecar binary not found at ${binaryPath}. In dev, run: cd local-stt && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`,
        ),
      );
      return;
    }

    console.log(
      `[STT] Spawning sidecar daemon: ${binaryPath} ${args.join(" ")}`,
    );
    bootTimeline.mark("sidecar:spawn", { binary: binaryPath });
    const proc = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });

    sidecarGeneration += 1;
    sidecarProcess = proc;
    sidecarModelId = modelId;
    sidecarReady = false;
    let settled = false;
    let resolveExit: () => void = () => undefined;
    const exitPromise = new Promise<void>((exitResolve) => {
      resolveExit = exitResolve;
    });
    processExitPromises.set(proc, exitPromise);

    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      proc.stdout?.removeListener("data", onData);
      callback();
    };

    // Packaged PyInstaller + MLX cold starts can spend tens of seconds
    // unpacking/importing before the model load log appears.
    const timeout = setTimeout(() => {
      console.error("[STT] Sidecar timed out waiting for ready signal");
      void killSidecar().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[STT] Timed-out sidecar shutdown failed: ${message}`);
      });
      settle(() => reject(new Error("Sidecar timed out loading model")));
    }, SIDECAR_STARTUP_TIMEOUT_MS);

    const stdoutDecoder = new StringDecoder("utf8");
    let stdoutBuffer = "";
    const onData = (chunk: Buffer) => {
      stdoutBuffer += stdoutDecoder.write(chunk);
      stdoutBuffer = consumeLines(stdoutBuffer, (line) => {
        try {
          const event = JSON.parse(line);
          if (event.type === "ready") {
            if (sidecarProcess !== proc) {
              settle(() => reject(new Error("Sidecar startup was superseded")));
              return false;
            }
            sidecarReady = true;
            console.log("[STT] Sidecar daemon ready");
            bootTimeline.mark("sidecar:ready");
            settle(resolve);
            return false;
          } else if (event.type === "error") {
            const message =
              typeof event.message === "string"
                ? event.message
                : "Sidecar failed during startup";
            settle(() => reject(new Error(message)));
            return false;
          }
          return true;
        } catch {
          console.warn("[STT] Non-JSON stdout during init:", line);
          return true;
        }
      });
    };

    proc.stdout?.on("data", onData);

    proc.stderr?.on("data", (data: Buffer) => {
      console.log("[STT/stderr]", data.toString().trimEnd());
    });

    proc.once("exit", (code) => {
      console.log(`[STT] Sidecar exited with code ${code}`);
      exitedProcesses.add(proc);
      resolveExit();
      clearTimeout(timeout);
      // A hard cancellation can be followed immediately by a new recording.
      // Do not let the old process's delayed exit clear its replacement.
      if (sidecarProcess === proc) {
        sidecarProcess = null;
        sidecarModelId = null;
        sidecarReady = false;
      }
      if (!settled) {
        settle(() =>
          reject(new Error(`Sidecar exited before ready with code ${code}`)),
        );
      }

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
      if (sidecarProcess === proc) {
        sidecarProcess = null;
        sidecarModelId = null;
        sidecarReady = false;
      }
      exitedProcesses.add(proc);
      resolveExit();
      settle(() => reject(err));
    });
  });
}

export async function killSidecar(): Promise<void> {
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
  sidecarReady = false;
  const forceTimer = setTimeout(() => {
    try {
      if (!exitedProcesses.has(proc) && proc.pid) {
        process.kill(proc.pid, "SIGKILL");
      }
    } catch {
      // ignore
    }
  }, 2000);
  const exitPromise = processExitPromises.get(proc);
  if (exitPromise) {
    let rejectShutdown: (error: Error) => void = () => undefined;
    const shutdownTimeout = new Promise<never>((_resolve, reject) => {
      rejectShutdown = reject;
    });
    const timeout = setTimeout(() => {
      rejectShutdown(
        new Error(`Sidecar did not exit within ${SIDECAR_SHUTDOWN_TIMEOUT_MS}ms`),
      );
    }, SIDECAR_SHUTDOWN_TIMEOUT_MS);
    try {
      await Promise.race([exitPromise, shutdownTimeout]);
    } finally {
      clearTimeout(timeout);
    }
  }
  clearTimeout(forceTimer);
  if (sidecarProcess === proc) {
    sidecarProcess = null;
    sidecarModelId = null;
    sidecarReady = false;
  }
}

/**
 * Abort the current inference and discard anything queued behind it. A timeout
 * must reclaim the ML process itself; rejecting only the renderer promise
 * leaves Parakeet allocating in the background.
 */
export function abortLocalTranscription(): void {
  autoRestartEnabled = false;
  sidecarTranscribeQueue = Promise.resolve();
  sidecarGeneration += 1;
  const proc = sidecarProcess;
  sidecarReady = false;
  if (!proc) return;

  if (!sidecarStoppingPromise) {
    const exitPromise = processExitPromises.get(proc) ?? Promise.resolve();
    const startupPromise = sidecarSpawnPromise ?? Promise.resolve();
    sidecarStoppingPromise = Promise.allSettled([
      exitPromise,
      startupPromise,
    ]).then(() => undefined);
  }

  console.warn("[STT] Aborting local transcription and killing sidecar");
  try {
    if (proc.pid) process.kill(proc.pid, "SIGKILL");
  } catch {
    // The process may have exited between the state check and kill.
  }
}

// ── Transcription ──────────────────────────────────────────────────────

export function transcribeLocal(
  pcmBuffer: Buffer,
  prompt?: string,
): Promise<LocalTranscribeResult> {
  if (pcmBuffer.length > LOCAL_STT_MAX_REQUEST_BYTES) {
    return Promise.reject(
      new Error(
        "Local transcription request exceeds the 30-second safety limit",
      ),
    );
  }
  // Sidecar stdout is a shared stream. Serialize requests so "done" events
  // cannot be consumed by the wrong in-flight caller.
  const requestGeneration = sidecarGeneration;
  const requestProcess = sidecarProcess;
  const queued = sidecarTranscribeQueue.then(
    () =>
      transcribeLocalOnce(
        pcmBuffer,
        requestProcess,
        requestGeneration,
        prompt,
      ),
    () =>
      transcribeLocalOnce(
        pcmBuffer,
        requestProcess,
        requestGeneration,
        prompt,
      ),
  );
  sidecarTranscribeQueue = queued.then(
    (): undefined => undefined,
    (): undefined => undefined,
  );
  return queued;
}

function transcribeLocalOnce(
  pcmBuffer: Buffer,
  expectedProcess: ReturnType<typeof spawn> | null,
  expectedGeneration: number,
  prompt?: string,
): Promise<LocalTranscribeResult> {
  return new Promise((resolve, reject) => {
    if (
      expectedGeneration !== sidecarGeneration ||
      expectedProcess !== sidecarProcess
    ) {
      reject(new Error("Local transcription cancelled before it started"));
      return;
    }
    if (!expectedProcess || !sidecarReady) {
      reject(new Error("Sidecar not running"));
      return;
    }

    const proc = expectedProcess;
    const stdoutDecoder = new StringDecoder("utf8");
    let stdoutBuffer = "";
    let resolved = false;
    let timeout: NodeJS.Timeout | null = null;

    const onData = (chunk: Buffer) => {
      stdoutBuffer += stdoutDecoder.write(chunk);
      stdoutBuffer = consumeLines(stdoutBuffer, (line) => {
        try {
          const event: SttEvent = JSON.parse(line);
          if (event.type === "done") {
            resolved = true;
            cleanup();
            resolve({ text: event.transcript, metrics: event.metrics });
            return false;
          }
          if (event.type === "error") {
            resolved = true;
            cleanup();
            reject(new Error(event.message));
            return false;
          }
          // partials are ignored for now (no streaming UI in local mode)
          return true;
        } catch {
          console.warn("[STT] Non-JSON stdout:", line);
          return true;
        }
      });
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

    // Timeout after 60s. Unlike the old behavior, the timeout immediately
    // terminates the worker so a runaway model cannot continue consuming RAM.
    timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        abortLocalTranscription();
        reject(new Error("Local transcription timed out"));
      }
    }, 60000);

    proc.once("exit", onExit);

    // Each request is two length-prefixed frames written to stdin: a small
    // JSON metadata frame (currently just an optional vocabulary/decoding
    // hint "prompt"), followed by the raw PCM frame. An empty metadata frame
    // ("{}") means no options were provided, which is the same as omitting
    // them, so behavior is unchanged when `prompt` is absent.
    try {
      const requestJson = Buffer.from(
        JSON.stringify(prompt ? { prompt } : {}),
        "utf8",
      );
      const requestLenBuf = Buffer.alloc(4);
      requestLenBuf.writeUInt32LE(requestJson.length);
      proc.stdin?.write(requestLenBuf);
      proc.stdin?.write(requestJson);

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

/** Reserve the shared sidecar stdout/stdin pair for one live dictation. */
export function startLocalStream(
  onPartial: (text: string) => void,
): Promise<LocalStreamingSession> {
  const requestGeneration = sidecarGeneration;
  const requestProcess = sidecarProcess;
  let resolveReady!: (session: LocalStreamingSession) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<LocalStreamingSession>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const reservation = sidecarTranscribeQueue.then(
    () =>
      runLocalStream(
        requestProcess,
        requestGeneration,
        onPartial,
        resolveReady,
        rejectReady,
      ),
    () =>
      runLocalStream(
        requestProcess,
        requestGeneration,
        onPartial,
        resolveReady,
        rejectReady,
      ),
  );
  sidecarTranscribeQueue = reservation.then(
    (): undefined => undefined,
    (): undefined => undefined,
  );
  return ready;
}

async function runLocalStream(
  expectedProcess: ReturnType<typeof spawn> | null,
  expectedGeneration: number,
  onPartial: (text: string) => void,
  resolveReady: (session: LocalStreamingSession) => void,
  rejectReady: (error: Error) => void,
): Promise<void> {
  if (
    expectedGeneration !== sidecarGeneration ||
    expectedProcess !== sidecarProcess
  ) {
    rejectReady(
      new Error("Local streaming session was cancelled before it started"),
    );
    return;
  }
  if (!expectedProcess || !sidecarReady) {
    rejectReady(new Error("Sidecar not running"));
    return;
  }

  const proc = expectedProcess;
  const stdoutDecoder = new StringDecoder("utf8");
  let stdoutBuffer = "";
  let totalBytes = 0;
  let finishing = false;
  let settled = false;
  let finalTimeout: NodeJS.Timeout | null = null;
  let resolveResult!: (result: LocalTranscribeResult) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<LocalTranscribeResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  type PendingWrite = {
    payload: Buffer;
    resolve: () => void;
    reject: (error: unknown) => void;
  };
  const pendingWrites: PendingWrite[] = [];
  let pendingWriteStart = 0;
  let writeInFlight: Promise<void> | null = null;
  let writeIdlePromise = Promise.resolve();
  let resolveWriteIdle: (() => void) | null = null;

  const cleanup = () => {
    if (finalTimeout) clearTimeout(finalTimeout);
    proc.stdout?.removeListener("data", onData);
    proc.removeListener("exit", onExit);
  };
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectResult(error);
  };
  const onData = (chunk: Buffer) => {
    stdoutBuffer += stdoutDecoder.write(chunk);
    stdoutBuffer = consumeLines(stdoutBuffer, (line) => {
      try {
        const event: SttEvent = JSON.parse(line);
        if (event.type === "partial") {
          onPartial(event.text);
        } else if (event.type === "done") {
          if (settled) return false;
          settled = true;
          cleanup();
          resolveResult({ text: event.transcript, metrics: event.metrics });
          return false;
        } else if (event.type === "error") {
          fail(new Error(event.message));
          return false;
        }
        return true;
      } catch {
        console.warn("[STT] Non-JSON stdout during stream:", line);
        return true;
      }
    });
  };
  const onExit = () =>
    fail(new Error("Sidecar exited during live transcription"));
  proc.stdout?.on("data", onData);
  proc.once("exit", onExit);

  const writeFrame = (payload: Buffer): void | Promise<void> =>
    (() => {
      const stdin = proc.stdin;
      if (!stdin || stdin.destroyed) {
        return Promise.reject(new Error("Sidecar input is unavailable"));
      }
      const header = Buffer.alloc(4);
      header.writeUInt32LE(payload.length);

      let headerReady = false;
      try {
        // Keep the header and PCM as separate buffers. With cork/uncork the
        // pipe can submit them together, while avoiding a new header+payload
        // allocation for every live audio batch.
        stdin.cork();
        headerReady = stdin.write(header);
        if (headerReady && (payload.length === 0 || stdin.write(payload))) {
          // The normal pipe path completes synchronously. The caller can
          // avoid the promise chain entirely for this common case.
          return;
        }
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      } finally {
        stdin.uncork();
      }

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const onHeaderDrain = () => {
          stdin.removeListener("drain", onHeaderDrain);
          writePayload();
        };
        const onPayloadDrain = () => {
          stdin.removeListener("drain", onPayloadDrain);
          settle();
        };
        const onError = (error: Error) => {
          stdin.removeListener("drain", onHeaderDrain);
          stdin.removeListener("drain", onPayloadDrain);
          if (settled) return;
          settled = true;
          reject(error);
        };
        const settle = () => {
          if (settled) return;
          settled = true;
          stdin.removeListener("error", onError);
          resolve();
        };
        const writePayload = () => {
          if (settled) return;
          try {
            if (payload.length === 0 || stdin.write(payload)) {
              settle();
            } else {
              stdin.once("drain", onPayloadDrain);
            }
          } catch (error) {
            onError(error instanceof Error ? error : new Error(String(error)));
          }
        };

        stdin.once("error", onError);
        if (headerReady) {
          // The header was accepted, but the payload filled the pipe.
          stdin.once("drain", onPayloadDrain);
        } else {
          // The header filled the pipe, so the payload has not been written.
          stdin.once("drain", onHeaderDrain);
        }
      });
    })();

  const ensureWriteIdlePromise = (): void => {
    if (resolveWriteIdle) return;
    writeIdlePromise = new Promise<void>((resolve) => {
      resolveWriteIdle = resolve;
    });
  };

  const finishWriteQueueIfIdle = (): void => {
    if (writeInFlight || pendingWriteStart < pendingWrites.length) return;
    pendingWrites.length = 0;
    pendingWriteStart = 0;
    const resolve = resolveWriteIdle;
    resolveWriteIdle = null;
    resolve?.();
  };

  const pumpWrites = (): void => {
    if (writeInFlight) return;

    while (pendingWriteStart < pendingWrites.length) {
      const pending = pendingWrites[pendingWriteStart++];
      let writeResult: void | Promise<void>;
      try {
        writeResult = writeFrame(pending.payload);
      } catch (error) {
        pending.reject(error);
        continue;
      }

      if (writeResult === undefined) {
        pending.resolve();
        continue;
      }

      writeInFlight = writeResult;
      void writeResult.then(pending.resolve, pending.reject).finally(() => {
        if (writeInFlight === writeResult) writeInFlight = null;
        pumpWrites();
      });
      return;
    }

    finishWriteQueueIfIdle();
  };

  const writeQueuedFrame = (payload: Buffer): Promise<void> => {
    if (!writeInFlight && pendingWriteStart >= pendingWrites.length) {
      let writeResult: void | Promise<void>;
      try {
        writeResult = writeFrame(payload);
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      if (writeResult === undefined) return Promise.resolve();

      ensureWriteIdlePromise();
      writeInFlight = writeResult;
      void writeResult.then(
        () => undefined,
        () => undefined,
      ).finally(() => {
        if (writeInFlight === writeResult) writeInFlight = null;
        pumpWrites();
      });
      return writeResult;
    }

    ensureWriteIdlePromise();
    const queued = new Promise<void>((resolve, reject) => {
      pendingWrites.push({ payload, resolve, reject });
    });
    pumpWrites();
    return queued;
  };

  const session: LocalStreamingSession = {
    push(pcmBuffer) {
      if (finishing || settled) {
        return Promise.reject(new Error("Local streaming session is closed"));
      }
      if (pcmBuffer.length === 0 || pcmBuffer.length % 2 !== 0) {
        return Promise.reject(new Error("Live PCM frame must contain PCM16 audio"));
      }
      if (pcmBuffer.length > LOCAL_STT_MAX_STREAM_FRAME_BYTES) {
        return Promise.reject(new Error("Live PCM frame exceeds the one-second limit"));
      }
      if (totalBytes + pcmBuffer.length > LOCAL_STT_MAX_STREAM_BYTES) {
        return Promise.reject(new Error("Live dictation exceeds the five-minute limit"));
      }
      totalBytes += pcmBuffer.length;
      const pushing = writeQueuedFrame(pcmBuffer);
      void pushing.catch((error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
      return pushing;
    },
    async finish() {
      if (!finishing && !settled) {
        finishing = true;
        await writeIdlePromise;
        await writeFrame(Buffer.alloc(0));
        finalTimeout = setTimeout(() => {
          fail(new Error("Live transcription finalization timed out"));
          abortLocalTranscription();
        }, 60_000);
      }
      return result;
    },
    cancel() {
      abortLocalTranscription();
    },
  };

  try {
    const metadata = Buffer.from(JSON.stringify({ op: "stream" }), "utf8");
    await writeFrame(metadata);
    resolveReady(session);
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    rejectReady(normalized);
    fail(normalized);
  }

  await result;
}
