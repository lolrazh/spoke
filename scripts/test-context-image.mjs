// Replay a user-supplied screenshot through production crop, OCR and correction.
// node scripts/test-context-image.mjs image.png raw.txt expected.txt output.json
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const [image, rawPath, expectedPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error("Expected image.png raw.txt expected.txt output.json");
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "spoke-image-"));
try {
  const executable = path.join(temp, "probe");
  execFileSync("clang", ["-x", "objective-c", "-fobjc-arc", "-mmacosx-version-min=14.0",
    ...["AppKit", "ApplicationServices", "Vision", "NaturalLanguage", "ScreenCaptureKit"].flatMap(name => ["-framework", name]),
    path.join(root, "native/tests/screen-image-probe.m"), "-o", executable]);
  const modulePath = path.join(temp, "pipeline.mjs");
  await build({ stdin: { contents: [
    'export { normalizeTranscript, prepareTranscriptPostprocessing } from "./src/main/transcriptPostprocessing";',
    'export { ScreenContextSession } from "./src/main/screenContextSession";',
  ].join("\n"), resolveDir: root }, outfile: modulePath, bundle: true, platform: "node", format: "esm" });
  const { normalizeTranscript, prepareTranscriptPostprocessing, ScreenContextSession } = await import(pathToFileURL(modulePath).href);
  const raw = (await fs.readFile(rawPath, "utf8")).trim();
  const expected = (await fs.readFile(expectedPath, "utf8")).trim();
  const rows = [];
  for (const scale of [1, 2]) {
    const capture = JSON.parse(execFileSync(executable, [path.resolve(image), "--window", String(scale), "10"], { encoding: "utf8", timeout: 30_000, maxBuffer: 2_000_000 }));
    for (const [index, run] of capture.runs.entries()) {
      const session = new ScreenContextSession();
      const id = `${scale}-${index}`;
      session.begin(id);
      assert.equal(session.accept(id, run.terms), true);
      session.freeze(id);
      const dictionary = session.read(id);
      prepareTranscriptPostprocessing(dictionary);
      const trace = [];
      const start = performance.now();
      const corrected = normalizeTranscript(raw, "parakeet", dictionary, trace);
      const correctionMs = performance.now() - start;
      rows.push({ backingScale: scale, ocrPixels: capture.ocrPixels, ocrMs: run.ms, correctionMs, dictionary, corrected, trace, passed: corrected === expected });
    }
  }
  const report = { scope: "Local screenshot replay. Production crop, OCR, terms, session and correction. No live capture, audio decode or paste.", raw, expected, rows };
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ report: path.resolve(outputPath), passed: rows.filter(row => row.passed).length, total: rows.length,
    ocrMs: rows.map(row => row.ocrMs), maxCorrectionMs: Math.max(...rows.map(row => row.correctionMs)), dictionary: rows[0].dictionary }, null, 2));
  assert.ok(rows.every(row => row.passed), "Screenshot pipeline mismatch; see report");
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
