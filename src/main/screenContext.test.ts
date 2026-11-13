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
  it("returns immediately and kills a stalled worker after two seconds", async () => {
    const { worker, service, session } = await setup();
    expect(service.beginScreenContext("a")).toBeUndefined();
    expect(session.read("a")).toEqual([]);
    vi.advanceTimersByTime(1999);
    expect(worker.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(worker.kill).toHaveBeenCalledWith("SIGKILL");
    expect(session.read("a")).toEqual([]);
    service.stopScreenContext();
  });
  it("cannot add a late OCR result after speech ends", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    service.freezeScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", terms: ["LateName"] }) + "\n");
    expect(session.read("a")).toEqual([]);
    expect(mocks.prepare).not.toHaveBeenCalled();
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
