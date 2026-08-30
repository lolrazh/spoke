import {
  getVadModelUrl,
  getVadOrtWasmBaseUrl,
  VAD_INIT_TIMEOUT_MS,
  VAD_MIN_TIMEOUT_MS,
} from "../config/vad";
import type {
  VadWorkerEvent,
  VadWorkerRequest,
  VadWorkerProcessResult,
  VadWorkerResponse,
  VadWorkerResult,
  VadWorkerSegment,
} from "./vadWorkerProtocol";

export interface VadWorkerClient {
  ready(): Promise<void>;
  processFrame(
    frame: Float32Array,
    frameIndex: number,
  ): Promise<VadWorkerProcessResult>;
  finish(frameIndex: number): Promise<VadWorkerEvent[]>;
  runClip(
    audio: Float32Array,
    sampleRateHz: number,
    timeoutMs: number,
  ): Promise<VadWorkerSegment[]>;
  dispose(): void;
}

type PendingRequest = {
  resolve: (result: VadWorkerResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type VadWorkerRequestWithoutId = VadWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

export function createVadWorkerClient(): VadWorkerClient {
  return new BrowserVadWorkerClient();
}

class BrowserVadWorkerClient implements VadWorkerClient {
  private readonly worker = new Worker(
    new URL("./vad.worker.ts", import.meta.url),
    { type: "module", name: "spoke-vad" },
  );
  private readonly pending = new Map<number, PendingRequest>();
  private readonly initializePromise: Promise<void>;
  private nextId = 1;
  private disposed = false;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<VadWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timeout);
      if (response.type === "error") {
        pending.reject(new Error(response.message));
      } else {
        pending.resolve(response.result);
      }
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "VAD worker crashed");
      this.disposed = true;
      this.worker.terminate();
      this.failAll(error);
    };
    this.initializePromise = this.request(
      {
        type: "init",
        modelUrl: getVadModelUrl(),
        wasmBaseUrl: getVadOrtWasmBaseUrl(),
      },
      VAD_INIT_TIMEOUT_MS,
    ).then(() => undefined);
  }

  ready(): Promise<void> {
    return this.initializePromise;
  }

  async processFrame(
    frame: Float32Array,
    frameIndex: number,
  ): Promise<VadWorkerProcessResult> {
    await this.ready();
    const result = await this.request(
      { type: "process", frameIndex, frame },
      VAD_MIN_TIMEOUT_MS,
      [frame.buffer],
    );
    return result as VadWorkerProcessResult;
  }

  async finish(frameIndex: number): Promise<VadWorkerEvent[]> {
    await this.ready();
    const result = await this.request(
      { type: "finish", frameIndex },
      VAD_MIN_TIMEOUT_MS,
    );
    return result as VadWorkerEvent[];
  }

  async runClip(
    audio: Float32Array,
    sampleRateHz: number,
    timeoutMs: number,
  ): Promise<VadWorkerSegment[]> {
    await this.ready();
    const buffer = audio.buffer as ArrayBuffer;
    const result = await this.request(
      { type: "run", audio: buffer, sampleRateHz },
      timeoutMs,
      [buffer],
    );
    return result as VadWorkerSegment[];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.failAll(new Error("VAD worker was disposed"));
  }

  private request(
    request: VadWorkerRequestWithoutId,
    timeoutMs: number,
    transfer: Transferable[] = [],
  ): Promise<VadWorkerResult> {
    if (this.disposed) {
      return Promise.reject(new Error("VAD worker was disposed"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`VAD worker timed out after ${timeoutMs}ms`);
        reject(error);
        this.dispose();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ ...request, id } as VadWorkerRequest, transfer);
    });
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
