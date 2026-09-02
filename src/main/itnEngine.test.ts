import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
}));

vi.mock("./itnPaths", () => ({
  getItnBinaryPath: () => "/tmp/spoke-itn",
  getItnGrammarPath: () => "/tmp/itn-grammar",
}));

vi.mock("node:child_process", () => ({
  default: { spawn: mocks.spawn },
  spawn: mocks.spawn,
}));

type MockInput = EventEmitter & {
  destroyed: boolean;
  end: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
};

type MockProcess = EventEmitter & {
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  stdin: MockInput;
  stdout: EventEmitter;
  stderr: EventEmitter;
};

function createProcess(): MockProcess {
  const stdin = new EventEmitter() as MockInput;
  stdin.destroyed = false;
  stdin.end = vi.fn(() => {
    stdin.destroyed = true;
  });
  stdin.write = vi.fn(() => true);

  const process = new EventEmitter() as MockProcess;
  process.killed = false;
  process.kill = vi.fn(() => {
    process.killed = true;
    process.emit("exit", null, "SIGKILL");
    return true;
  });
  process.stdin = stdin;
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  return process;
}

function frame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const output = Buffer.alloc(4 + payload.length);
  output.writeUInt32LE(payload.length, 0);
  payload.copy(output, 4);
  return output;
}

async function importEngine() {
  return import("./itnEngine");
}

describe("itnEngine", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
  });

  it("frames requests, handles split responses, and reuses the helper", async () => {
    const process = createProcess();
    mocks.spawn.mockReturnValue(process);
    const { normalizeWithItn } = await importEngine();

    const first = normalizeWithItn("five dollars");
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    expect(mocks.spawn).toHaveBeenCalledWith(
      "/tmp/spoke-itn",
      ["/tmp/itn-grammar"],
      { stdio: ["pipe", "pipe", "pipe"], detached: false },
    );

    const request = mocks.spawn.mock.results[0].value.stdin.write.mock
      .calls[0][0] as Buffer;
    expect(request.readUInt32LE(0)).toBe(Buffer.byteLength("five dollars"));
    expect(request.subarray(4).toString("utf8")).toBe("five dollars");

    const response = frame("$5");
    process.stdout.emit("data", response.subarray(0, 2));
    process.stdout.emit("data", response.subarray(2));
    await expect(first).resolves.toBe("$5");

    const second = normalizeWithItn("two hundred");
    await vi.waitFor(() => expect(process.stdin.write).toHaveBeenCalledTimes(2));
    process.stdout.emit("data", frame("200"));
    await expect(second).resolves.toBe("200");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("clears a failed spawn so a later request can retry", async () => {
    const process = createProcess();
    mocks.spawn.mockReturnValue(process);
    mocks.existsSync.mockReturnValueOnce(false);
    const { normalizeWithItn } = await importEngine();

    await expect(normalizeWithItn("five")).rejects.toThrow(
      "ITN helper binary not found",
    );

    const retryProcess = createProcess();
    mocks.existsSync.mockReturnValue(true);
    mocks.spawn.mockReturnValue(retryProcess);
    const retry = normalizeWithItn("five");
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    retryProcess.stdout.emit("data", frame("5"));

    await expect(retry).resolves.toBe("5");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("rejects pending work when the helper exits", async () => {
    const process = createProcess();
    mocks.spawn.mockReturnValue(process);
    const { normalizeWithItn } = await importEngine();

    const pending = normalizeWithItn("hello");
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    process.emit("exit", 1, null);

    await expect(pending).rejects.toThrow("ITN helper exited with code 1");
  });
});
