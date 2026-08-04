import { app, type WebContents } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { MicDevice } from "../types/shared";

const AUDIO_CAPTURE_APP_NAME = "Spoke Audio Capture.app";
const AUDIO_CAPTURE_EXECUTABLE_NAME = "Spoke Audio Capture";
const HEADER_BYTES = 4;

enum AudioEventType {
  ready = 1,
  started = 2,
  frame = 3,
  stopped = 4,
  error = 5,
}

type PendingResult<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

export function getAudioCapturePath(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(
    root,
    "native",
    "bin",
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

class NativeAudioCaptureManager {
  private process: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private active = false;
  private target: WebContents | null = null;
  private pendingStart: PendingResult<void> | null = null;
  private pendingStop: PendingResult<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private stdoutBuffer = Buffer.alloc(0);

  async start(target: WebContents, deviceId: string): Promise<void> {
    if (!isNativeAudioCaptureAvailable()) {
      throw new Error("Native macOS audio capture is unavailable.");
    }
    if (this.active || this.pendingStart) {
      throw new Error("A native audio capture is already running.");
    }

    await this.ensureProcess();
    this.target = target;
    this.active = true;

    const started = new Promise<void>((resolve, reject) => {
      this.pendingStart = { resolve, reject };
    });

    try {
      this.sendCommand({ action: "start", deviceId });
      await started;
    } catch (error) {
      this.active = false;
      this.target = null;
      this.pendingStart = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    if (this.stopPromise) return this.stopPromise;

    const stopped = new Promise<void>((resolve, reject) => {
      this.pendingStop = { resolve, reject };
    });
    this.stopPromise = stopped;
    try {
      this.sendCommand({ action: "stop" });
    } catch (error) {
      this.pendingStop = null;
      this.stopPromise = null;
      throw error;
    }
    try {
      await stopped;
    } finally {
      if (this.stopPromise === stopped) this.stopPromise = null;
    }
  }

  cancel(): void {
    if (!this.process || !this.active) return;
    this.active = false;
    this.target = null;
    this.pendingStart = null;
    this.pendingStop = null;
    this.stopPromise = null;
    try {
      this.sendCommand({ action: "cancel" });
    } catch {
      // The process may already be closing during cancellation.
    }
  }

  shutdown(): void {
    const child = this.process;
    if (!child) return;

    this.process = null;
    this.ready = null;
    this.active = false;
    this.target = null;
    this.pendingStart?.reject(new Error("Native audio capture is shutting down."));
    this.pendingStop?.reject(new Error("Native audio capture is shutting down."));
    this.pendingStart = null;
    this.pendingStop = null;

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
    this.stdoutBuffer = Buffer.alloc(0);

    this.ready = new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
      child.stderr.on("data", (chunk: Buffer) => {
        const message = chunk.toString().trim();
        if (message) console.warn(`[NativeAudio] ${message}`);
      });
      child.once("error", (error) => {
        this.rejectPending(error);
        reject(error);
      });
      child.once("close", (code, signal) => {
        const error = new Error(
          `Native audio helper exited${
            code === null ? ` with signal ${signal ?? "unknown"}` : ` with code ${code}`
          }.`,
        );
        this.rejectPending(error);
        if (this.process === child) {
          this.process = null;
          this.ready = null;
          this.active = false;
          this.target = null;
        }
        if (code !== 0) reject(error);
      });

      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    await this.ready;
  }

  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

    while (this.stdoutBuffer.length >= HEADER_BYTES) {
      const payloadLength = this.stdoutBuffer.readUInt32BE(0);
      const packetLength = HEADER_BYTES + payloadLength;
      if (this.stdoutBuffer.length < packetLength) return;

      const packet = this.stdoutBuffer.subarray(HEADER_BYTES, packetLength);
      this.stdoutBuffer = this.stdoutBuffer.subarray(packetLength);
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
          this.target.send("audio-capture:frame", Buffer.from(payload));
        }
        return;
      case AudioEventType.stopped:
        if (this.target && !this.target.isDestroyed()) {
          this.target.send("audio-capture:stopped");
        }
        this.active = false;
        this.target = null;
        this.pendingStop?.resolve();
        this.pendingStop = null;
        return;
      case AudioEventType.error: {
        const message = payload.toString() || "Native audio capture failed.";
        const error = new Error(message);
        this.pendingStart?.reject(error);
        this.pendingStart = null;
        this.pendingStop?.reject(error);
        this.pendingStop = null;
        if (this.target && !this.target.isDestroyed()) {
          this.target.send("audio-capture:error", message);
        }
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
