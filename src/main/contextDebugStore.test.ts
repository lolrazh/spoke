// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContextDebugStore } from "./contextDebugStore";

let temp: string;
beforeEach(async () => { temp = await fs.mkdtemp(path.join(os.tmpdir(), "spoke-debug-test-")); });
afterEach(async () => { await fs.rm(temp, { recursive: true, force: true }); });
describe("local debug datasets", () => {
  it("writes nothing until explicitly started", async () => {
    const store = new ContextDebugStore(path.join(temp, "sets"));
    expect(store.begin("test", {})).toBe(false);
    store.record("test", "raw", { text: "private" });
    expect((await store.overview()).recording).toBe(false);
    expect(await fs.readdir(temp)).toEqual([]);
  });
  it("persists trace and labels, reopens after restart, and keeps audio opt-in", async () => {
    const store = new ContextDebugStore(temp);
    await store.start("App test", false);
    expect(store.begin("run-a", {})).toBe(true);
    store.record("run-a", "correction", { raw: "D flash two", corrected: "DFlash2 two" });
    store.appendAudio("run-a", Buffer.alloc(32)); store.flushAudio("run-a");
    const overview = await store.overview();
    await store.annotate(overview.setId!, "run-a", "DFlash2", "Visible in heading");
    store.stop();
    expect(store.begin("run-b", {})).toBe(false);
    const reopened = new ContextDebugStore(temp);
    const saved = await reopened.overview();
    expect(saved.recording).toBe(false);
    expect(saved.sets[0].label).toBe("App test");
    const { run } = await reopened.read(saved.setId!, "run-a");
    expect(run.expected).toBe("DFlash2"); expect(run.audio).toEqual([]);
    expect(run.events[1].data.raw).toBe("D flash two");
    expect((await fs.stat(path.join(temp, saved.setId!, "run-a.json"))).mode & 0o777).toBe(0o600);
  });
  it("saves valid WAV clips and deletes all artifacts for a removed run", async () => {
    const store = new ContextDebugStore(temp);
    await store.start("Audio test", true); store.begin("run-a", {});
    store.appendAudio("run-a", Buffer.from([1, 2, 3, 4])); store.flushAudio("run-a");
    store.image("run-a", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9sAAAAASUVORK5CYII=");
    const { setId } = await store.overview();
    const { run, image } = await store.read(setId!, "run-a");
    expect(image).toMatch(/^data:image\/png;base64,/u);
    const wav = await fs.readFile(path.join(temp, setId!, run.audio[0]));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF"); expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.subarray(44)).toEqual(Buffer.from([1, 2, 3, 4]));
    await store.remove(setId!, "run-a");
    store.record("run-a", "late", { text: "should not return" });
    expect((await store.overview()).runs).toEqual([]);
    expect(await fs.readdir(path.join(temp, setId!))).toEqual(["manifest.json"]);
  });
  it("bounds capture and rejects path traversal", async () => {
    const store = new ContextDebugStore(temp);
    await store.start("Bounded test", false);
    for (let i = 0; i < 50; i++) expect(store.begin(`run-${i}`, {})).toBe(true);
    expect(store.begin("extra", {})).toBe(false);
    const overview = await store.overview();
    expect(overview.recording).toBe(false); expect(overview.runs).toHaveLength(50);
    await expect(store.read("../outside", "run")).rejects.toThrow("Invalid test ID");
    await expect(store.read(overview.setId!, "../../secret")).rejects.toThrow("Invalid test ID");
  });
});
