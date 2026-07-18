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

function createSidecarProcess(pid = 12345) {
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
  proc.pid = pid;
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
      "MLX STT sidecar binary not found",
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

  describe("transcribeLocal", () => {
    async function startReadySidecar() {
      const proc = createSidecarProcess();
      mocks.spawn.mockReturnValue(proc);
      const engine = await importEngine();

      const startup = engine.spawnSidecar();
      proc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));
      await startup;

      return { proc, engine };
    }

    function requestFrames(proc: ReturnType<typeof createSidecarProcess>) {
      // stdin.write is called 4 times per request: metadata length, metadata
      // JSON, audio length, audio bytes.
      const calls = proc.stdin.write.mock.calls.map(([chunk]) => chunk);
      return {
        metadataLenBuf: calls[0] as Buffer,
        metadataJsonBuf: calls[1] as Buffer,
        audioLenBuf: calls[2] as Buffer,
        audioBuf: calls[3] as Buffer,
      };
    }

    it("sends an empty metadata frame when no prompt is provided", async () => {
      const { proc, engine } = await startReadySidecar();
      const pcm = Buffer.from([1, 2, 3, 4]);

      const resultPromise = engine.transcribeLocal(pcm);
      // transcribeLocal queues the request behind a resolved promise, so the
      // stdin writes/listener registration happen in a microtask; flush it
      // before emitting the "done" event the request is waiting on.
      await Promise.resolve();
      proc.stdout.emit(
        "data",
        Buffer.from(
          '{"type":"done","transcript":"hi","metrics":{"inference_ms":1}}\n',
        ),
      );
      await resultPromise;

      const { metadataLenBuf, metadataJsonBuf, audioLenBuf, audioBuf } =
        requestFrames(proc);
      expect(JSON.parse(metadataJsonBuf.toString("utf8"))).toEqual({});
      expect(metadataLenBuf.readUInt32LE(0)).toBe(metadataJsonBuf.length);
      expect(audioLenBuf.readUInt32LE(0)).toBe(pcm.length);
      expect(audioBuf).toEqual(pcm);
    });

    it("passes the prompt through the request metadata frame", async () => {
      const { proc, engine } = await startReadySidecar();
      const pcm = Buffer.from([9, 9, 9, 9]);
      const prompt = "Your vocabulary includes: Spoke, Sandeep";

      const resultPromise = engine.transcribeLocal(pcm, prompt);
      await Promise.resolve();
      proc.stdout.emit(
        "data",
        Buffer.from(
          '{"type":"done","transcript":"hi","metrics":{"inference_ms":1}}\n',
        ),
      );
      await resultPromise;

      const { metadataJsonBuf } = requestFrames(proc);
      expect(JSON.parse(metadataJsonBuf.toString("utf8"))).toEqual({
        prompt,
      });
    });

    it("rejects oversized requests before they reach the sidecar", async () => {
      const { engine } = await startReadySidecar();
      const thirtySecondsOfPcm16 = 30 * 16_000 * 2;

      expect(engine.LOCAL_STT_MAX_REQUEST_BYTES).toBe(thirtySecondsOfPcm16);

      await expect(
        engine.transcribeLocal(Buffer.alloc(thirtySecondsOfPcm16 + 1)),
      ).rejects.toThrow("30-second safety limit");
    });

    it("kills the process when transcription is explicitly aborted", async () => {
      const { engine } = await startReadySidecar();
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

      engine.abortLocalTranscription();

      expect(kill).toHaveBeenCalledWith(12345, "SIGKILL");
      kill.mockRestore();
    });

    it("does not let an aborted process clear its replacement on exit", async () => {
      const { proc: abortedProc, engine } = await startReadySidecar();
      const replacementProc = createSidecarProcess(54321);
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

      engine.abortLocalTranscription();
      mocks.spawn.mockReturnValue(replacementProc);
      const replacementStartup = engine.spawnSidecar();
      replacementProc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));
      await replacementStartup;

      abortedProc.emit("exit", 1);

      expect(engine.isSidecarRunning()).toBe(true);
      await engine.spawnSidecar();
      expect(mocks.spawn).toHaveBeenCalledTimes(2);
      kill.mockRestore();
    });
  });
});
