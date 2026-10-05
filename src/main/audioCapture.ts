import {
  app,
  type WebContents,
  type Event as ElectronEvent,
  type WebContentsDidStartNavigationEventParams,
} from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { MicDevice } from "../types/shared";

const AUDIO_CAPTURE_APP_NAME = "Spoke Audio Capture.app";
const AUDIO_CAPTURE_EXECUTABLE_NAME = "Spoke Audio Capture";
const HEADER_BYTES = 4;
const EMPTY_STDOUT_BUFFER = Buffer.alloc(0);
export const NATIVE_AUDIO_STOP_TIMEOUT_MS = 2_000;
export const NATIVE_AUDIO_START_TIMEOUT_MS = 10_000;

enum AudioEventType {
  ready = 1,
  started = 2,
  frame = 3,
  stopped = 4,
  error = 5,
  level = 6,
}

type PendingResult<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

export function getAudioCapturePath(): string {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), "native", "bin");
  return path.join(
    root,
    AUDIO_CAPTURE_APP_NAME,
    "Contents",
    "MacOS",
    AUDIO_CAPTURE_EXECUTABLE_NAME,
  );
}

export function isNativeAudioCaptureAvailable(): boolean {
  return process.platform === "darwin" && fs.existsSync(getAudioCapturePath());
}

export async function listNativeAudioDevices(): Promise<MicDevice[]> {
  if (!isNativeAudioCaptureAvailable()) return [];

  const child = spawn(getAudioCapturePath(), ["--list-devices"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });

  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() || `Native microphone listing exited with code ${exitCode}.`,
    );
  }

  const devices = JSON.parse(stdout) as unknown;
  if (!Array.isArray(devices)) {
    throw new Error("Native microphone listing returned an invalid payload.");
  }

  return devices.filter(isMicDevice);
}

export class NativeAudioCaptureManager {
  private process: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private active = false;
  private target: WebContents | null = null;
  private pendingStart: PendingResult<void> | null = null;
  private pendingStop: PendingResult<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private stdoutBuffer: Buffer<ArrayBufferLike> = EMPTY_STDOUT_BUFFER;
  private generation = 0;
  private sessionId: string | undefined;
  private removeOwnerListeners: (() => void) | null = null;

  /** True from start() until the capture is stopped or fails. */
  isCapturing(): boolean {
    return this.active;
  }

  async start(target: WebContents, deviceId: string, sessionId: string): Promise<void> {
    if (!isNativeAudioCaptureAvailable()) {
      throw new Error("Native macOS audio capture is unavailable.");
    }
    if (this.active || this.pendingStart) {
      throw new Error("A native audio capture is already running.");
    }
    if (target.isDestroyed()) throw new Error("The audio capture owner is closed.");

    // Reserve ownership before the first await. Cancellation must also work
    // while the helper is booting, before it has acknowledged start.
    const generation = ++this.generation;
    this.target = target;
    this.sessionId = sessionId;
    this.active = true;
    this.bindOwner(target);
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      const starting = (async () => {
        await this.ensureProcess();
        if (this.generation !== generation) {
          throw new Error("Native audio capture was cancelled.");
        }
        const started = new Promise<void>((resolve, reject) => {
          this.pendingStart = { resolve, reject };
          this.sendCommand({ action: "start", deviceId });
        });
        await started;
        if (this.generation !== generation) {
          throw new Error("Native audio capture was cancelled.");
        }
      })();
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Native audio capture did not acknowledge start."));
        }, NATIVE_AUDIO_START_TIMEOUT_MS);
        timeoutId.unref?.();
      });
      await Promise.race([starting, timeout]);
    } catch (error) {
      if (this.generation === generation) {
        this.terminateProcess(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async stop(target?: WebContents, sessionId?: string): Promise<void> {
    if (!this.active || !this.ownsCapture(target, sessionId)) return;
    if (this.stopPromise) return this.stopPromise;
    const generation = this.generation;

    const stopped = new Promise<void>((resolve, reject) => {
      this.pendingStop = { resolve, reject };
      this.sendCommand({ action: "stop" });
    });
    this.stopPromise = stopped;
    let timeoutId: NodeJS.Timeout | null = null;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `Native audio capture did not acknowledge stop within ${NATIVE_AUDIO_STOP_TIMEOUT_MS}ms.`,
            ),
          );
        }, NATIVE_AUDIO_STOP_TIMEOUT_MS);
        timeoutId.unref?.();
      });
      await Promise.race([stopped, timeout]);
    } catch (error) {
      // A helper that is stuck draining native audio cannot process a later
      // cancel command. Force-terminate it so the next recording cannot
      // inherit a wedged process or an unresolved stop waiter.
      if (this.generation === generation) {
        this.terminateProcess(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (this.stopPromise === stopped) this.stopPromise = null;
    }
  }

  cancel(target?: WebContents, sessionId?: string): void {
    if (!this.active || !this.ownsCapture(target, sessionId)) return;
    // Cancel has no native acknowledgement. Retiring this process prevents
    // late packets or a stuck native start from entering the next recording.
    this.pendingStop?.resolve();
    this.pendingStop = null;
    this.terminateProcess(new Error("Native audio capture was cancelled."));
  }

  shutdown(): void {
    const child = this.process;
    if (!child) return;

    this.rejectPending(new Error("Native audio capture is shutting down."));
    this.process = null;
    this.ready = null;
    this.releaseOwner();

    try {
      child.stdin.write(`${JSON.stringify({ action: "shutdown" })}\n`);
    } catch {
      // Fall through to the forced kill below.
    }
    const forceKill = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 500);
    forceKill.unref?.();
  }

  private async ensureProcess(): Promise<void> {
    if (this.process && this.ready) {
      await this.ready;
      return;
    }

    const child = spawn(getAudioCapturePath(), [], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });
    this.process = child;
    this.stdoutBuffer = EMPTY_STDOUT_BUFFER;

    this.ready = new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => {
        if (this.process === child) this.handleStdout(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const message = chunk.toString().trim();
        if (message) console.warn(`[NativeAudio] ${message}`);
      });
      child.once("error", (error) => {
        if (this.process === child) this.failCapture(error);
        reject(error);
      });
      child.once("close", (code, signal) => {
        const error = new Error(
          `Native audio helper exited${
            code === null ? ` with signal ${signal ?? "unknown"}` : ` with code ${code}`
          }.`,
        );
        if (this.process === child) {
          this.failCapture(error);
        }
        reject(error);
      });

      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    await this.ready;
  }

  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;

  private handleStdout(chunk: Buffer): void {
    // Native capture normally emits complete packets. Reuse that chunk
    // directly; only join buffers when a packet crosses a stdout boundary.
    this.stdoutBuffer =
      this.stdoutBuffer.length === 0
        ? chunk
        : Buffer.concat([this.stdoutBuffer, chunk]);

    while (this.stdoutBuffer.length >= HEADER_BYTES) {
      const payloadLength = this.stdoutBuffer.readUInt32BE(0);
      const packetLength = HEADER_BYTES + payloadLength;
      if (this.stdoutBuffer.length < packetLength) return;

      const packet = this.stdoutBuffer.subarray(HEADER_BYTES, packetLength);
      this.stdoutBuffer =
        this.stdoutBuffer.length === packetLength
          ? EMPTY_STDOUT_BUFFER
          : this.stdoutBuffer.subarray(packetLength);
      const type = packet[0] as AudioEventType;
      this.handleEvent(type, packet.subarray(1));
    }
  }

  private handleEvent(type: AudioEventType, payload: Buffer): void {
    switch (type) {
      case AudioEventType.ready:
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
        return;
      case AudioEventType.started:
        this.pendingStart?.resolve();
        this.pendingStart = null;
        return;
      case AudioEventType.frame:
        if (this.target && !this.target.isDestroyed()) {
          // Electron serializes the payload for renderer IPC. Avoid making a
          // second PCM copy in the main process before that serialization.
          this.target.send("audio-capture:frame", payload, this.sessionId);
        }
        return;
      case AudioEventType.level: {
        if (payload.byteLength !== 4) return;
        const level = payload.readFloatLE(0);
        if (!Number.isFinite(level) || level < 0) return;
        if (this.target && !this.target.isDestroyed()) {
          this.target.send("audio-capture:level", Math.min(1, level), this.sessionId);
        }
        return;
      }
      case AudioEventType.stopped:
        if (this.target && !this.target.isDestroyed()) {
          this.target.send("audio-capture:stopped", this.sessionId);
        }
        this.pendingStop?.resolve();
        this.pendingStop = null;
        this.releaseOwner();
        return;
      case AudioEventType.error: {
        const message = payload.toString() || "Native audio capture failed.";
        const error = new Error(message);
        this.failCapture(error);
        return;
      }
      default:
        console.warn(`[NativeAudio] Unknown event type ${type}.`);
    }
  }

  private sendCommand(command: {
    action: "start" | "stop" | "cancel" | "shutdown";
    deviceId?: string;
  }): void {
    if (!this.process?.stdin || this.process.stdin.destroyed) {
      throw new Error("Native audio helper is not running.");
    }
    this.process.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private rejectPending(error: Error): void {
    this.pendingStart?.reject(error);
    this.pendingStop?.reject(error);
    this.pendingStart = null;
    this.pendingStop = null;
    this.readyReject?.(error);
    this.readyResolve = null;
    this.readyReject = null;
  }

  private terminateProcess(error: Error): void {
    const child = this.process;
    this.rejectPending(error);
    this.process = null;
    this.ready = null;
    this.stdoutBuffer = EMPTY_STDOUT_BUFFER;
    this.releaseOwner();

    try {
      if (child && !child.killed) child.kill("SIGKILL");
    } catch {
      // The helper may have exited between the timeout and forced kill.
    }
  }

  private ownsCapture(target?: WebContents, sessionId?: string): boolean {
    return (!target || target === this.target) &&
      (sessionId === undefined || sessionId === this.sessionId);
  }

  private bindOwner(target: WebContents): void {
    const sessionId = this.sessionId;
    const cancel = () => this.cancel(target, sessionId);
    const onNavigation = (event: ElectronEvent<WebContentsDidStartNavigationEventParams>) => {
      if (event.isMainFrame && !event.isSameDocument) cancel();
    };
    target.on("did-start-navigation", onNavigation);
    target.on("render-process-gone", cancel);
    target.on("destroyed", cancel);
    this.removeOwnerListeners = () => {
      target.removeListener("did-start-navigation", onNavigation);
      target.removeListener("render-process-gone", cancel);
      target.removeListener("destroyed", cancel);
    };
  }

  private releaseOwner(): void {
    ++this.generation;
    this.removeOwnerListeners?.();
    this.removeOwnerListeners = null;
    this.active = false;
    this.target = null;
    this.sessionId = undefined;
    this.stopPromise = null;
  }

  private failCapture(error: Error): void {
    if (this.target && !this.target.isDestroyed()) {
      this.target.send("audio-capture:error", error.message, this.sessionId);
    }
    this.terminateProcess(error);
  }
}

export const nativeAudioCapture = new NativeAudioCaptureManager();

export function shutdownNativeAudioCapture(): void {
  nativeAudioCapture.shutdown();
}

function isMicDevice(value: unknown): value is MicDevice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.label === "string";
}
