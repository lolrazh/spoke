import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVadWorkerClient } from "./vadWorkerClient";
import type {
  VadWorkerRequest,
  VadWorkerResponse,
} from "./vadWorkerProtocol";

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<VadWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: Array<{
    request: VadWorkerRequest;
    transfer: Transferable[];
  }> = [];
  readonly terminate = vi.fn();

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(request: VadWorkerRequest, transfer: Transferable[] = []): void {
    this.messages.push({ request, transfer });
  }

  respond(response: VadWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<VadWorkerResponse>);
  }

  crash(message = "VAD worker crashed"): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe("vadWorkerClient", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes a module worker and transfers audio frames without copying", async () => {
    const client = createVadWorkerClient();
    const worker = FakeWorker.instances[0];
    const init = worker.messages[0].request;

    expect(worker.options).toMatchObject({ type: "module", name: "spoke-vad" });
    expect(init.type).toBe("init");
    worker.respond({ id: init.id, type: "result", result: undefined });
    await client.ready();

    const frame = new Float32Array(1536);
    const processing = client.processFrame(frame, 7);
    await Promise.resolve();
    const processMessage = worker.messages[1];
    const processRequest = processMessage.request;
    if (processRequest.type !== "process") {
      throw new Error("Expected a process request");
    }
    expect(processMessage.request).toMatchObject({
      type: "process",
      frameIndex: 7,
    });
    expect(processRequest.frame).toBe(frame);
    expect(processMessage.transfer).toEqual([frame.buffer]);
    worker.respond({
      id: processRequest.id,
      type: "result",
      result: {
        events: [{ type: "speech-start", frameIndex: 7 }],
        frame: processRequest.frame,
      },
    });

    await expect(processing).resolves.toMatchObject({
      events: [{ type: "speech-start", frameIndex: 7 }],
      frame: processRequest.frame,
    });
    expect(processMessage.transfer).toEqual([frame.buffer]);
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("waits for initialization when processing starts immediately", async () => {
    const client = createVadWorkerClient();
    const worker = FakeWorker.instances[0];
    const init = worker.messages[0].request;
    const frame = new Float32Array(1536);
    const processing = client.processFrame(frame, 2);

    expect(worker.messages).toHaveLength(1);

    worker.respond({ id: init.id, type: "result", result: undefined });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
    const processMessage = worker.messages[1];
    if (processMessage.request.type !== "process") {
      throw new Error("Expected a process request");
    }
    worker.respond({
      id: processMessage.request.id,
      type: "result",
      result: { events: [], frame },
    });

    await expect(processing).resolves.toMatchObject({ events: [], frame });
    client.dispose();
  });

  it("rejects pending initialization when the session is disposed", async () => {
    const client = createVadWorkerClient();
    const worker = FakeWorker.instances[0];
    const ready = client.ready();

    client.dispose();

    await expect(ready).rejects.toThrow("disposed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects pending initialization when the browser worker crashes", async () => {
    const client = createVadWorkerClient();
    const worker = FakeWorker.instances[0];
    const ready = client.ready();

    worker.crash();

    await expect(ready).rejects.toThrow("VAD worker crashed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
