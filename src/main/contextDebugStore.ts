import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ContextDebugOverview, ContextDebugRun } from "../../shared/contextDebug";

const validId = (id: string) => /^[\w-]{1,80}$/u.test(id);
const MAX_RUNS = 50;
const MAX_AUDIO_BYTES = 16000 * 2 * 300;

function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Opt-in test data. Disk work is queued and is never awaited by dictation. */
export class ContextDebugStore {
  private recording = false;
  private setId: string | null = null;
  private includeAudio = false;
  private runs = new Map<string, ContextDebugRun>();
  private audio = new Map<string, { chunks: Buffer[]; bytes: number; part: number }>();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private error?: string;

  constructor(readonly root: string) {}

  private location(setId: string, id?: string): string {
    if (!validId(setId) || (id !== undefined && !validId(id))) throw new Error("Invalid test ID.");
    return path.join(this.root, setId, ...(id ? [`${id}.json`] : []));
  }

  private enqueue(work: () => Promise<void>): void {
    if (this.pending >= 128) { this.error = "Debug storage is busy. Capture stopped."; this.recording = false; return; }
    this.pending++;
    this.queue = this.queue.then(work).catch(() => {
      this.error = "Could not save debug data. Capture stopped.";
      this.recording = false;
    }).finally(() => { this.pending--; });
  }

  private save(run: ContextDebugRun): void {
    if (!this.setId) return;
    const file = this.location(this.setId, run.id);
    this.enqueue(async () => {
      await fs.writeFile(`${file}.tmp`, JSON.stringify(run, null, 2), { mode: 0o600 });
      await fs.rename(`${file}.tmp`, file);
    });
  }

  async start(label: string, includeAudio: boolean): Promise<void> {
    this.recording = false;
    for (const id of this.audio.keys()) this.flushAudio(id);
    await this.queue;
    const id = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
    const folder = this.location(id);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(folder, "manifest.json"), JSON.stringify({ schema: 1, id, label: label.trim().slice(0, 120) || "Context test", createdAt: new Date().toISOString(), includeAudio, sampleRate: 16000, maxRuns: MAX_RUNS }, null, 2), { mode: 0o600 });
    this.runs.clear(); this.audio.clear(); this.error = undefined;
    this.setId = id; this.includeAudio = includeAudio; this.recording = true;
  }

  stop(): void { this.recording = false; }

  begin(id: string, data: Record<string, unknown>): boolean {
    if (!this.recording || !validId(id) || this.runs.has(id)) return false;
    if (this.runs.size >= MAX_RUNS) { this.recording = false; this.error = "50 runs saved. Start a new test set to continue."; return false; }
    const run: ContextDebugRun = { schema: 1, id, createdAt: new Date().toISOString(), expected: "", notes: "", events: [], audio: [] };
    this.runs.set(id, run);
    this.record(id, "begin", data);
    return true;
  }

  has(id?: string): boolean { return !!id && this.runs.has(id); }

  record(id: string | undefined, stage: string, data: Record<string, unknown>): void {
    const run = id ? this.runs.get(id) : undefined;
    if (!run || run.events.length >= 256) return;
    run.events.push({ atMs: Date.now() - Date.parse(run.createdAt), stage, data });
    this.save(run);
  }

  image(id: string, base64: unknown): void {
    const run = this.runs.get(id);
    if (!run || !this.setId || typeof base64 !== "string" || base64.length > 4_000_000) return;
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return;
    const file = path.join(this.location(this.setId), `${id}.png`);
    run.image = `${id}.png`;
    this.enqueue(() => fs.writeFile(file, bytes, { mode: 0o600 }));
    this.save(run);
  }

  appendAudio(id: string | undefined, pcm: Buffer): void {
    if (!id || !this.includeAudio || !this.has(id)) return;
    const current = this.audio.get(id) ?? { chunks: [], bytes: 0, part: 0 };
    if (current.bytes + pcm.length > MAX_AUDIO_BYTES) return;
    current.chunks.push(Buffer.from(pcm)); current.bytes += pcm.length;
    this.audio.set(id, current);
  }

  flushAudio(id?: string): void {
    if (!id || !this.setId) return;
    const audio = this.audio.get(id), run = this.runs.get(id);
    if (!audio?.chunks.length || !run) return;
    const name = `${id}-audio-${audio.part++}.wav`;
    const file = path.join(this.location(this.setId), name);
    const chunks = audio.chunks; audio.chunks = [];
    run.audio.push(name);
    this.enqueue(() => fs.writeFile(file, wav(Buffer.concat(chunks)), { mode: 0o600 }));
    this.save(run);
  }

  async overview(selected?: string): Promise<ContextDebugOverview> {
    await this.queue;
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const sets = (await Promise.all(entries.filter(entry => entry.isDirectory() && validId(entry.name)).map(async entry => {
      try { const data = JSON.parse(await fs.readFile(path.join(this.location(entry.name), "manifest.json"), "utf8")); return { id: entry.name, label: String(data.label).slice(0, 120) }; } catch { return null; }
    }))).filter((item): item is { id: string; label: string } => !!item).sort((a, b) => b.id.localeCompare(a.id));
    const setId = selected ?? this.setId ?? sets[0]?.id ?? null;
    let runs: ContextDebugRun[] = [];
    if (setId === this.setId) runs = [...this.runs.values()];
    else if (setId) {
      const files = await fs.readdir(this.location(setId));
      runs = (await Promise.all(files.filter(file => file.endsWith(".json") && file !== "manifest.json").slice(0, MAX_RUNS).map(async file => {
        try { return JSON.parse(await fs.readFile(path.join(this.location(setId), file), "utf8")) as ContextDebugRun; } catch { return null; }
      }))).filter((run): run is ContextDebugRun => !!run && Array.isArray(run.events));
    }
    return { recording: this.recording, setId, root: this.root, error: this.error, sets, runs: runs.map(run => ({ id: run.id, createdAt: run.createdAt, expected: run.expected, stages: run.events.map(event => event.stage) })).reverse() };
  }

  async read(setId: string, id: string): Promise<{ run: ContextDebugRun; image?: string }> {
    await this.queue;
    const run = JSON.parse(await fs.readFile(this.location(setId, id), "utf8")) as ContextDebugRun;
    const png = await fs.readFile(path.join(this.location(setId), `${id}.png`)).catch(() => undefined);
    return { run, ...(png ? { image: `data:image/png;base64,${png.toString("base64")}` } : {}) };
  }

  async annotate(setId: string, id: string, expected: string, notes: string): Promise<void> {
    const { run } = await this.read(setId, id);
    const current = setId === this.setId ? this.runs.get(id) ?? run : run;
    current.expected = expected.slice(0, 4000); current.notes = notes.slice(0, 4000);
    const file = this.location(setId, id);
    this.enqueue(async () => { await fs.writeFile(`${file}.tmp`, JSON.stringify(current, null, 2), { mode: 0o600 }); await fs.rename(`${file}.tmp`, file); });
    await this.queue;
  }

  async remove(setId: string, id: string): Promise<void> {
    this.location(setId, id);
    if (setId === this.setId) { this.runs.delete(id); this.audio.delete(id); }
    await this.queue;
    const folder = this.location(setId);
    for (const file of await fs.readdir(folder)) {
      if (file === `${id}.json` || file === `${id}.png` || file === `${id}.json.tmp` || (file.startsWith(`${id}-audio-`) && file.endsWith(".wav"))) await fs.unlink(path.join(folder, file));
    }
  }

  folder(setId?: string): string { return setId ? this.location(setId) : this.root; }
}
