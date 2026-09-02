/**
 * Persistent native NeMo inverse-text-normalization engine.
 *
 * The helper accepts little-endian uint32 length-prefixed UTF-8 frames. Keep
 * requests serialized: this makes one stdout response unambiguously belong to
 * one transcript and keeps the native process's memory bounded.
 */

import * as fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getItnBinaryPath, getItnGrammarPath } from "./itnPaths";

export const ITN_REQUEST_TIMEOUT_MS = 5000;
export const ITN_SHUTDOWN_TIMEOUT_MS = 1500;
export const ITN_MAX_FRAME_BYTES = 16 * 1024 * 1024;

type PendingRequest = {
  process: ChildProcessWithoutNullStreams;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

let itnProcess: ChildProcessWithoutNullStreams | null = null;
let itnSpawnPromise: Promise<ChildProcessWithoutNullStreams> | null = null;
let itnRequestQueue: Promise<void> = Promise.resolve();
let stdoutBuffer = Buffer.alloc(0);
let pendingRequests: PendingRequest[] = [];
const processExitPromises = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>();
const exitedProcesses = new WeakSet<ChildProcessWithoutNullStreams>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function frame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.length > ITN_MAX_FRAME_BYTES) {
    throw new Error("ITN input frame is too large");
  }
  const output = Buffer.allocUnsafe(4 + payload.length);
  output.writeUInt32LE(payload.length, 0);
  payload.copy(output, 4);
  return output;
}

function rejectPendingForProcess(
  process: ChildProcessWithoutNullStreams,
  error: Error,
): void {
  const failed = pendingRequests.filter((request) => request.process === process);
  pendingRequests = pendingRequests.filter((request) => request.process !== process);
  for (const request of failed) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
}

function failProcess(
  process: ChildProcessWithoutNullStreams,
  error: Error,
): void {
  if (itnProcess === process) {
    itnProcess = null;
    stdoutBuffer = Buffer.alloc(0);
  }
  rejectPendingForProcess(process, error);
}

function parseResponses(process: ChildProcessWithoutNullStreams): void {
  while (stdoutBuffer.length >= 4) {
    const length = stdoutBuffer.readUInt32LE(0);
    if (length > ITN_MAX_FRAME_BYTES) {
      throw new Error("ITN output frame is too large");
    }
    const frameLength = 4 + length;
    if (stdoutBuffer.length < frameLength) return;

    const request = pendingRequests[0];
    if (!request || request.process !== process) {
      throw new Error("ITN returned an unexpected response");
    }
    pendingRequests.shift();
    clearTimeout(request.timeout);
    const output = stdoutBuffer.subarray(4, frameLength).toString("utf8");
    stdoutBuffer = stdoutBuffer.subarray(frameLength);
    request.resolve(output);
  }
}

function spawnItnOnce(): ChildProcessWithoutNullStreams {
  const binaryPath = getItnBinaryPath();
  const grammarPath = getItnGrammarPath();
  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `ITN helper binary not found at ${binaryPath}. Run npm run build:itn.`,
    );
  }
  if (
    !fs.existsSync(grammarPath) ||
    !fs.existsSync(`${grammarPath}/tokenize_and_classify.far`) ||
    !fs.existsSync(`${grammarPath}/verbalize.far`)
  ) {
    throw new Error(
      `ITN grammar files not found at ${grammarPath}. Run npm run build:itn.`,
    );
  }

  console.log(`[ITN] Spawning native normalizer: ${binaryPath}`);
  const process = spawn(binaryPath, [grammarPath], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });
  itnProcess = process;
  stdoutBuffer = Buffer.alloc(0);

  let resolveExit!: () => void;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  processExitPromises.set(process, exitPromise);

  process.stdout.on("data", (chunk: Buffer) => {
    if (itnProcess !== process) return;
    try {
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
      parseResponses(process);
    } catch (error) {
      const normalized = new Error(`ITN response parsing failed: ${errorMessage(error)}`);
      console.error(`[ITN] ${normalized.message}`);
      failProcess(process, normalized);
      try {
        process.kill("SIGKILL");
      } catch {
        // The process may have exited between the parse failure and kill.
      }
    }
  });

  process.stderr.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trim();
    if (message) console.warn(`[ITN/stderr] ${message}`);
  });

  const onProcessError = (error: Error) => {
    console.error(`[ITN] Native normalizer error: ${error.message}`);
    failProcess(process, error);
    exitedProcesses.add(process);
    resolveExit();
  };
  process.once("error", onProcessError);
  process.stdin.once("error", onProcessError);

  process.once("exit", (code, signal) => {
    exitedProcesses.add(process);
    resolveExit();
    const reason = signal
      ? `signal ${signal}`
      : `code ${code ?? "unknown"}`;
    failProcess(process, new Error(`ITN helper exited with ${reason}`));
    console.warn(`[ITN] Native normalizer exited with ${reason}`);
  });

  return process;
}

async function ensureItnProcess(): Promise<ChildProcessWithoutNullStreams> {
  if (itnProcess && !itnProcess.killed && !itnProcess.stdin.destroyed) {
    return itnProcess;
  }
  if (itnSpawnPromise) return itnSpawnPromise;

  const start = Promise.resolve().then(spawnItnOnce);
  const tracked = start.finally(() => {
    if (itnSpawnPromise === tracked) itnSpawnPromise = null;
  });
  itnSpawnPromise = tracked;
  return tracked;
}

async function normalizeWithItnOnce(text: string): Promise<string> {
  const process = await ensureItnProcess();
  return new Promise((resolve, reject) => {
    if (itnProcess !== process || process.stdin.destroyed) {
      reject(new Error("ITN helper is not running"));
      return;
    }

    const request: PendingRequest = {
      process,
      resolve,
      reject,
      timeout: setTimeout(() => {
        const index = pendingRequests.indexOf(request);
        if (index < 0) return;
        pendingRequests.splice(index, 1);
        const timeoutError = new Error("ITN normalization timed out");
        reject(timeoutError);
        failProcess(process, timeoutError);
        try {
          process.kill("SIGKILL");
        } catch {
          // The process may have exited between the timeout and kill.
        }
      }, ITN_REQUEST_TIMEOUT_MS),
    };
    pendingRequests.push(request);

    try {
      process.stdin.write(frame(text));
    } catch (error) {
      const normalized = new Error(`ITN request failed: ${errorMessage(error)}`);
      const index = pendingRequests.indexOf(request);
      if (index >= 0) pendingRequests.splice(index, 1);
      clearTimeout(request.timeout);
      reject(normalized);
      failProcess(process, normalized);
    }
  });
}

/** Normalize one final transcript with the persistent native helper. */
export function normalizeWithItn(text: string): Promise<string> {
  if (!text.trim()) return Promise.resolve(text);
  const operation = itnRequestQueue.then(
    () => normalizeWithItnOnce(text),
    () => normalizeWithItnOnce(text),
  );
  itnRequestQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

/** Stop the helper during app shutdown. */
export async function killItn(): Promise<void> {
  const process = itnProcess;
  if (!process) return;

  failProcess(process, new Error("ITN helper stopped"));
  try {
    process.stdin.end();
  } catch {
    // The pipe may already be closed.
  }

  const exitPromise = processExitPromises.get(process);
  if (!exitPromise || exitedProcesses.has(process)) return;

  let resolveTimeout!: () => void;
  const timeoutPromise = new Promise<void>((resolve) => {
    resolveTimeout = resolve;
  });
  const timeout = setTimeout(() => {
    try {
      if (!exitedProcesses.has(process)) process.kill("SIGKILL");
    } catch {
      // The process may have exited between the check and kill.
    }
    resolveTimeout();
  }, ITN_SHUTDOWN_TIMEOUT_MS);
  try {
    await Promise.race([exitPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
  if (itnProcess === process) itnProcess = null;
}

export function isItnRunning(): boolean {
  return itnProcess !== null && !itnProcess.killed;
}
