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
  const stdin = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    cork: ReturnType<typeof vi.fn>;
    uncork: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  };
  stdin.write = vi.fn(() => true);
  stdin.cork = vi.fn();
  stdin.uncork = vi.fn();
  stdin.destroyed = false;
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: typeof stdin;
    killed: boolean;
    pid: number;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = stdin;
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

  it("rejects a different model while the current model is still starting", async () => {
    const proc = createSidecarProcess();
    mocks.spawn.mockReturnValue(proc);
    const { spawnSidecar } = await importEngine();

    const startup = spawnSidecar("model-a");
    await expect(spawnSidecar("model-b")).rejects.toThrow(
      "still stopping or starting",
    );
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    proc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));
    await startup;
  });

  it("does not permit a replacement spawn until the old process exits", async () => {
    const oldProc = createSidecarProcess();
    const replacementProc = createSidecarProcess(54321);
    mocks.spawn.mockReturnValueOnce(oldProc).mockReturnValueOnce(replacementProc);
    const { killSidecar, spawnSidecar } = await importEngine();

    const startup = spawnSidecar("model-a");
    oldProc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));
    await startup;

    const stopping = killSidecar();
    await expect(spawnSidecar("model-b")).rejects.toThrow(
      "must exit before",
    );
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    oldProc.emit("exit", 0);
    await stopping;
    const replacement = spawnSidecar("model-b");
    replacementProc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));
    await replacement;

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
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
      const { proc, engine } = await startReadySidecar();
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

      engine.abortLocalTranscription();

      expect(kill).toHaveBeenCalledWith(12345, "SIGKILL");
      proc.emit("exit", 1);
      kill.mockRestore();
    });

    it("waits for an aborted process to exit before starting its replacement", async () => {
      const { proc: abortedProc, engine } = await startReadySidecar();
      const replacementProc = createSidecarProcess(54321);
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

      engine.abortLocalTranscription();
      mocks.spawn.mockReturnValue(replacementProc);
      const replacementStartup = engine.spawnSidecar();
      await Promise.resolve();
      expect(mocks.spawn).toHaveBeenCalledTimes(1);

      abortedProc.emit("exit", 1);
      await vi.waitFor(() => {
        expect(mocks.spawn).toHaveBeenCalledTimes(2);
      });
      replacementProc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));
      await replacementStartup;

      expect(engine.isSidecarRunning()).toBe(true);
      await engine.spawnSidecar();
      expect(mocks.spawn).toHaveBeenCalledTimes(2);
      kill.mockRestore();
    });

    it("does not overlap a replacement with an aborted startup", async () => {
      const abortedProc = createSidecarProcess();
      const replacementProc = createSidecarProcess(54321);
      mocks.spawn
        .mockReturnValueOnce(abortedProc)
        .mockReturnValueOnce(replacementProc);
      const { spawnSidecar, abortLocalTranscription } = await importEngine();

      const startup = spawnSidecar("model-a");
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
      abortLocalTranscription();

      const replacementStartup = spawnSidecar("model-b");
      await Promise.resolve();
      expect(mocks.spawn).toHaveBeenCalledTimes(1);

      abortedProc.emit("exit", 1);
      await vi.waitFor(() => {
        expect(mocks.spawn).toHaveBeenCalledTimes(2);
      });
      replacementProc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));

      await expect(startup).rejects.toThrow("Sidecar exited before ready");
      await expect(replacementStartup).resolves.toBeUndefined();
      kill.mockRestore();
    });

    it("rejects queued requests from an aborted generation", async () => {
      const { proc, engine } = await startReadySidecar();
      const replacementProc = createSidecarProcess(54321);
      mocks.spawn.mockReturnValue(replacementProc);
      const active = engine.transcribeLocal(Buffer.from([1]));
      await Promise.resolve();
      const queued = engine.transcribeLocal(Buffer.from([2]));
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

      engine.abortLocalTranscription();
      proc.emit("exit", 1);
      const replacementStartup = engine.spawnSidecar("replacement");
      await vi.waitFor(() => {
        expect(mocks.spawn).toHaveBeenCalledTimes(2);
      });
      replacementProc.stdout.emit("data", Buffer.from('{"type":"ready"}\n'));
      await replacementStartup;

      await expect(active).rejects.toThrow("Sidecar exited during transcription");
      await expect(queued).rejects.toThrow(
        "Local transcription cancelled before it started",
      );
      expect(proc.stdin.write).toHaveBeenCalledTimes(4);
      expect(replacementProc.stdin.write).not.toHaveBeenCalled();
      kill.mockRestore();
    });

    it("streams framed PCM, forwards partials, and finalizes in order", async () => {
      const { proc, engine } = await startReadySidecar();
      const onPartial = vi.fn();
      const session = await engine.startLocalStream(onPartial);

      const metadataLengthBuf = proc.stdin.write.mock.calls[0][0] as Buffer;
      const metadataLength = metadataLengthBuf.readUInt32LE(0);
      const metadataPayload = proc.stdin.write.mock.calls[1][0] as Buffer;
      expect(
        JSON.parse(metadataPayload.subarray(0, metadataLength).toString("utf8")),
      ).toEqual({ op: "stream" });

      proc.stdout.emit(
        "data",
        Buffer.from('{"type":"partial","text":"hello"}\n'),
      );
      const pushing = session.push(Buffer.from([1, 0, 2, 0]));
      expect(proc.stdin.write).toHaveBeenCalledTimes(4);
      await pushing;
      const finishing = session.finish();
      await Promise.resolve();
      proc.stdout.emit(
        "data",
        Buffer.from(
          '{"type":"done","transcript":"hello world","metrics":{"inference_ms":2}}\n',
        ),
      );

      await expect(finishing).resolves.toMatchObject({ text: "hello world" });
      expect(onPartial).toHaveBeenCalledWith("hello");
      const audioLengthBuf = proc.stdin.write.mock.calls[2][0] as Buffer;
      const audioPayload = proc.stdin.write.mock.calls[3][0] as Buffer;
      expect(audioLengthBuf.readUInt32LE(0)).toBe(4);
      expect(audioPayload).toEqual(Buffer.from([1, 0, 2, 0]));
      const finalFrame = proc.stdin.write.mock.calls[4][0] as Buffer;
      expect(finalFrame.readUInt32LE(0)).toBe(0);
      expect(proc.stdin.cork).toHaveBeenCalled();
      expect(proc.stdin.uncork).toHaveBeenCalled();
    });

    it("waits for stdin backpressure before finalization", async () => {
      const { proc, engine } = await startReadySidecar();
      const session = await engine.startLocalStream(vi.fn());
      const audioPayload = Buffer.from([1, 0, 2, 0]);
      let blockAudioPayload = true;
      proc.stdin.write.mockImplementation((chunk: Buffer) => {
        if (blockAudioPayload && chunk.equals(audioPayload)) return false;
        return true;
      });

      const pushing = session.push(audioPayload);
      await Promise.resolve();
      expect(proc.stdin.write).toHaveBeenCalledTimes(4);

      const finishing = session.finish();
      await Promise.resolve();
      expect(proc.stdin.write).toHaveBeenCalledTimes(4);

      blockAudioPayload = false;
      proc.stdin.emit("drain");
      await expect(pushing).resolves.toBeUndefined();
      await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(5));
      proc.stdout.emit(
        "data",
        Buffer.from(
          '{"type":"done","transcript":"hello","metrics":{"inference_ms":2}}\n',
        ),
      );

      await expect(finishing).resolves.toMatchObject({ text: "hello" });
    });

    it("serializes overlapping pushes after the first backpressured frame", async () => {
      const { proc, engine } = await startReadySidecar();
      const session = await engine.startLocalStream(vi.fn());
      const firstPayload = Buffer.from([1, 0]);
      const secondPayload = Buffer.from([2, 0]);
      let blockFirstPayload = true;
      proc.stdin.write.mockImplementation((chunk: Buffer) => {
        if (blockFirstPayload && chunk.equals(firstPayload)) {
          blockFirstPayload = false;
          return false;
        }
        return true;
      });

      const first = session.push(firstPayload);
      const second = session.push(secondPayload);
      expect(proc.stdin.write).toHaveBeenCalledTimes(4);

      proc.stdin.emit("drain");
      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();

      const writes = proc.stdin.write.mock.calls.map(([chunk]) => chunk as Buffer);
      expect(writes.slice(2)).toEqual([
        Buffer.from([2, 0, 0, 0]),
        firstPayload,
        Buffer.from([2, 0, 0, 0]),
        secondPayload,
      ]);
    });

    it("preserves a multibyte transcript split across stdout chunks", async () => {
      const { proc, engine } = await startReadySidecar();
      const session = await engine.startLocalStream(vi.fn());
      const finishing = session.finish();
      await Promise.resolve();

      const transcript = "नमस्ते";
      const doneLine = Buffer.from(
        `${JSON.stringify({
          type: "done",
          transcript,
          metrics: { inference_ms: 2 },
        })}\n`,
        "utf8",
      );
      const firstCharacterOffset = doneLine.indexOf(Buffer.from("न", "utf8"));
      const splitOffset = firstCharacterOffset + 1;
      proc.stdout.emit("data", doneLine.subarray(0, splitOffset));
      proc.stdout.emit("data", doneLine.subarray(splitOffset));

      await expect(finishing).resolves.toMatchObject({ text: transcript });
    });

    it("rejects unsafe live PCM before writing it", async () => {
      const { proc, engine } = await startReadySidecar();
      const session = await engine.startLocalStream(vi.fn());

      await expect(session.push(Buffer.from([1]))).rejects.toThrow("PCM16");
      await expect(
        session.push(Buffer.alloc(engine.LOCAL_STT_MAX_STREAM_FRAME_BYTES + 2)),
      ).rejects.toThrow("one-second limit");
      // Startup writes the metadata header and payload separately. Invalid
      // audio must not add any further writes.
      expect(proc.stdin.write).toHaveBeenCalledTimes(2);

      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
      session.cancel();
      proc.emit("exit", 1);
      kill.mockRestore();
    });
  });
});
