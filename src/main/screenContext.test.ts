import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), prepare: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn, default: { spawn: mocks.spawn } }));
vi.mock("node:fs", () => ({ existsSync: () => true, default: { existsSync: () => true } }));
vi.mock("./helperPaths", () => ({ getHelperPath: () => "/fixture/helper" }));
vi.mock("./contextVocabulary", () => ({ contextDictionary: mocks.prepare, clearContextVocabulary: vi.fn() }));

describe.runIf(process.platform === "darwin")("context helper deadlines", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(100_000); });
  afterEach(() => { vi.useRealTimers(); });
  async function setup() {
    const makeWorker = () => Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    const worker = makeWorker();
    const nextWorker = makeWorker();
    mocks.spawn.mockReturnValueOnce(worker).mockReturnValue(nextWorker);
    const service = await import("./screenContext");
    const { screenContextSession: session } = await import("./screenContextSession");
    return { worker, nextWorker, service, session };
  }
  it("returns immediately and kills a stalled worker after eight seconds", async () => {
    const { worker, service, session } = await setup();
    expect(service.beginScreenContext("a")).toBeUndefined();
    expect(session.read("a")).toEqual([]);
    vi.advanceTimersByTime(7999);
    expect(worker.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(worker.kill).toHaveBeenCalledWith("SIGKILL");
    expect(session.read("a")).toEqual([]);
    service.stopScreenContext();
  });
  it("keeps the capture pending when a diagnostic stage arrives", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ event: "debug-stage", id: "a", stage: "screenshot-ready", ms: 120 }) + "\n");
    expect(session.read("a")).toEqual([]);
    expect(mocks.prepare).not.toHaveBeenCalled();
    vi.advanceTimersByTime(8000);
    expect(worker.kill).toHaveBeenCalledWith("SIGKILL");
    service.stopScreenContext();
  });
  it("does not put synthetic OCR ahead of a cold on-demand capture", async () => {
    const { worker, service } = await setup();
    service.beginScreenContext("a");
    const requests = String(worker.stdin.read()).trim().split("\n").map(line => JSON.parse(line));
    expect(requests).toEqual([{ command: "capture", id: "a", debug: false }]);
    service.stopScreenContext();
  });
  it("warms during idle preparation and reuses that worker for capture", async () => {
    const { worker, service } = await setup();
    service.prewarmScreenContext();
    expect(JSON.parse(worker.stdin.read().toString())).toEqual({ command: "warm" });
    service.beginScreenContext("a");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(worker.stdin.read().toString()).command).toBe("capture");
    service.stopScreenContext();
  });
  it("keeps the prepared process through idle time without reusing old terms", async () => {
    const { worker, service, session } = await setup();
    service.prewarmScreenContext();
    service.beginScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", status: "ready", terms: ["OldName"] }) + "\n");
    service.endScreenContext("a");
    vi.advanceTimersByTime(120_000);
    expect(worker.kill).not.toHaveBeenCalled();
    service.beginScreenContext("b");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(session.read("b")).toEqual([]);
    service.stopScreenContext();
    expect(worker.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("accepts an in-flight result after speech stops until correction consumes it", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    service.markScreenContextSpeechStopped("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", status: "ready", terms: ["DFlash2"] }) + "\n");
    service.freezeScreenContext("a");
    expect(session.read("a")).toEqual(["DFlash2"]);
    expect(session.accept("a", ["TooLate"])).toBe(false);
    service.stopScreenContext();
  });
  it("cannot add an OCR result after its consumer freezes context", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    service.freezeScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", terms: ["LateName"] }) + "\n");
    expect(session.read("a")).toEqual([]);
    expect(mocks.prepare).not.toHaveBeenCalled();
    service.stopScreenContext();
  });
  it("accepts cold initialization while speech continues without waiting at stop", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    vi.advanceTimersByTime(2500);
    worker.stdout.emit("data", JSON.stringify({ id: "a", status: "ready", terms: ["DFlash2"] }) + "\n");
    service.freezeScreenContext("a");
    expect(session.read("a")).toEqual(["DFlash2"]);
    expect(worker.kill).not.toHaveBeenCalled();
    service.stopScreenContext();
  });
  it("supplements sparse Accessibility terms with OCR without waiting at speech stop", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", status: "partial", terms: ["ChatGPT"] }) + "\n");
    expect(session.read("a")).toEqual(["ChatGPT"]);
    worker.stdout.emit("data", JSON.stringify({ id: "a", status: "ready", terms: ["DFlash2", "NVFP4", "ChatGPT"] }) + "\n");
    service.freezeScreenContext("a");
    expect(session.read("a")).toEqual(["DFlash2", "NVFP4", "ChatGPT"]);
    vi.advanceTimersByTime(2000);
    expect(worker.kill).not.toHaveBeenCalled();
    service.stopScreenContext();
  });
  it("keeps the frozen snapshot when OCR completes after speech stop", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", status: "partial", terms: ["DFlash2"] }) + "\n");
    service.freezeScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", status: "ready", terms: ["DifferentName"] }) + "\n");
    expect(session.read("a")).toEqual(["DFlash2"]);
    service.stopScreenContext();
  });
  it("can restart immediately after cancellation and ignores an old end event", async () => {
    const { worker, nextWorker, service, session } = await setup();
    service.beginScreenContext("a");
    service.endScreenContext("a");
    service.beginScreenContext("b");
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    service.endScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", terms: ["OldName"] }) + "\n");
    worker.emit("exit", 0);
    nextWorker.stdout.emit("data", JSON.stringify({ id: "b", terms: ["DFlash2"] }) + "\n");
    expect(session.read("b")).toEqual(["DFlash2"]);
    service.stopScreenContext();
  });
  it("backs off only after an unexpected worker failure", async () => {
    const { worker, service } = await setup();
    service.beginScreenContext("a");
    worker.emit("exit", 1);
    service.beginScreenContext("b");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    service.beginScreenContext("c");
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    service.stopScreenContext();
  });
  it("does not resurrect a window after a change event overtakes its OCR result", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", status: "partial", terms: ["FirstWindow"] }) + "\n");
    worker.stdout.emit("data", JSON.stringify({ id: "a", status: "target-changed", terms: [] }) + "\n");
    worker.stdout.emit("data", JSON.stringify({ id: "a", status: "ready", terms: ["StaleName"] }) + "\n");
    expect(session.read("a")).toEqual([]);
    service.stopScreenContext();
  });
  it("discards ready names on target changes and worker failure", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", terms: ["OpenAI"] }) + "\n");
    expect(session.read("a")).toEqual(["OpenAI"]);
    service.freezeScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", terms: [], status: "target-changed" }) + "\n");
    expect(session.read("a")).toEqual([]);
    worker.emit("exit", 1);
    expect(session.accept("a", ["StaleName"])).toBe(false);
  });
});
