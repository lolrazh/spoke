import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  spawn: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: mocks.existsSync,
}));

vi.mock("child_process", () => ({
  default: {
    spawn: mocks.spawn,
  },
  spawn: mocks.spawn,
}));

vi.mock("./sidecarPaths", () => ({
  getSidecarBinaryPath: () => "/tmp/spoke-stt",
  getSidecarArgs: () => ["sidecar.py"],
}));

function createSidecarProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn> };
    killed: boolean;
    pid: number;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn() };
  proc.killed = false;
  proc.pid = 12345;
  return proc;
}

async function importEngine() {
  return import("./sidecarEngine");
}

describe("sidecarEngine", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
  });

  it("shares one spawn promise while the sidecar is starting", async () => {
    const proc = createSidecarProcess();
    mocks.spawn.mockReturnValue(proc);
    const { spawnSidecar } = await importEngine();

    const first = spawnSidecar();
    const second = spawnSidecar();

    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    proc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("does not spawn again when the existing sidecar is ready", async () => {
    const proc = createSidecarProcess();
    mocks.spawn.mockReturnValue(proc);
    const { spawnSidecar } = await importEngine();

    const first = spawnSidecar();
    proc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));
    await first;

    await spawnSidecar();

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("clears the shared spawn promise after startup failure", async () => {
    const failedProc = createSidecarProcess();
    const readyProc = createSidecarProcess();
    mocks.spawn.mockReturnValueOnce(failedProc).mockReturnValueOnce(readyProc);
    const { spawnSidecar } = await importEngine();

    const failed = spawnSidecar();
    failedProc.emit("exit", 1);
    await expect(failed).rejects.toThrow("Sidecar exited before ready");

    const retry = spawnSidecar();
    readyProc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));
    await expect(retry).resolves.toBeUndefined();

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });

  it("rejects without spawning when the sidecar binary is missing", async () => {
    mocks.existsSync.mockReturnValue(false);
    const { spawnSidecar } = await importEngine();

    await expect(spawnSidecar()).rejects.toThrow(
      "MLX Whisper sidecar binary not found",
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("rejects startup when the sidecar emits an error event", async () => {
    const proc = createSidecarProcess();
    mocks.spawn.mockReturnValue(proc);
    const { spawnSidecar } = await importEngine();

    const startup = spawnSidecar();
    proc.stdout.emit(
      "data",
      Buffer.from(
        '{"type":"error","message":"Local model is incomplete","code":"model_load_failed"}\n',
      ),
    );

    await expect(startup).rejects.toThrow("Local model is incomplete");
  });

  it("allows a long packaged cold-start timeout", async () => {
    const { SIDECAR_STARTUP_TIMEOUT_MS } = await importEngine();

    expect(SIDECAR_STARTUP_TIMEOUT_MS).toBeGreaterThanOrEqual(120000);
  });
});
