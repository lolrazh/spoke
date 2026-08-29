import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVadWorkerClient } from "./vadWorkerClient";
import type { VadWorkerRequest, VadWorkerResponse } from "./vadWorkerProtocol";

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
    expect(processMessage.request).toMatchObject({
      type: "process",
      frameIndex: 7,
    });
    expect(processMessage.transfer).toEqual([frame.buffer]);
    worker.respond({
      id: processMessage.request.id,
      type: "result",
      result: [{ type: "speech-start", frameIndex: 7 }],
    });

    await expect(processing).resolves.toEqual([
      { type: "speech-start", frameIndex: 7 },
    ]);
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
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
