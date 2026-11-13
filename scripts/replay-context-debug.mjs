// Offline replay of term extraction and text correction; no screen or audio capture.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const setPath = process.argv[2];
if (!setPath) { console.error('Usage: node scripts/replay-context-debug.mjs "/path/to/test-set"'); process.exit(1); }
const root = fileURLToPath(new URL("../", import.meta.url));
const folder = path.resolve(setPath);
const manifest = JSON.parse(await fs.readFile(path.join(folder, "manifest.json"), "utf8"));
if (manifest.schema !== 1) throw new Error("Unsupported test-set version.");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "spoke-context-replay-"));
try {
  const modulePath = path.join(temp, "correction.mjs");
  await build({ entryPoints: [path.join(root, "src/main/transcriptPostprocessing.ts")], outfile: modulePath, bundle: true, platform: "node", format: "esm" });
  const { normalizeTranscript } = await import(pathToFileURL(modulePath).href);
  const helper = path.join(root, "native/bin/Spoke Helper.app/Contents/MacOS/Spoke Helper");
  const report = { schema: 1, replayedAt: new Date().toISOString(), setId: manifest.id, scope: "Text extraction and correction only; uses saved ASR output. No audio re-decoding.", runs: [] };
  for (const file of await fs.readdir(folder)) {
    if (!file.endsWith(".json") || file === "manifest.json" || file.startsWith("replay-")) continue;
    const run = JSON.parse(await fs.readFile(path.join(folder, file), "utf8"));
    if (run.schema !== 1 || !Array.isArray(run.events)) continue;
    const native = run.events.find(event => event.stage === "native-context")?.data;
    const text = native?.ocr?.text ?? native?.accessibility?.text;
    const extraction = typeof text === "string" ? JSON.parse(execFileSync(helper, ["--context-analyze-text"], { input: text.slice(0, 4000), encoding: "utf8", timeout: 5000, maxBuffer: 1_000_000 })) : null;
    const request = run.events.find(event => event.stage === "decode-request")?.data;
    const corrections = run.events.filter(event => event.stage === "correction").map(({ data }) => {
      const trace = [];
      const corrected = normalizeTranscript(data.raw, request?.family, data.dictionary ?? [], trace);
      return { raw: data.raw, savedCorrected: data.corrected, replayCorrected: corrected, changed: corrected !== data.corrected, trace };
    });
    report.runs.push({ id: run.id, expected: run.expected, notes: run.notes, extractedNow: extraction?.selectedTerms ?? null, extractedBefore: native?.ocr?.selectedTerms ?? native?.accessibility?.selectedTerms ?? null, corrections, exactExpectedMatch: corrections.length === 1 && run.expected ? corrections[0].replayCorrected === run.expected : null });
  }
  const output = path.join(folder, `replay-${Date.now()}.json`);
  await fs.writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ runs: report.runs.length, changedRuns: report.runs.filter(run => run.corrections.some(value => value.changed)).length, report: output }, null, 2));
} finally { await fs.rm(temp, { recursive: true, force: true }); }
