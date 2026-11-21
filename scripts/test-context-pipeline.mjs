// Local integration probe. Synthetic images and supplied ASR text only.
// Usage: node scripts/test-context-pipeline.mjs [output-root] [asr-json] [pcm16-wav]
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "spoke-pipeline-"));
const output = path.resolve(process.argv[2] ?? temp);
try {
  const test = path.join(temp, "native-test");
  execFileSync("clang", ["-x", "objective-c", "-fobjc-arc", "-mmacosx-version-min=14.0",
    ...["AppKit", "ApplicationServices", "Vision", "NaturalLanguage", "ScreenCaptureKit"].flatMap(name => ["-framework", name]),
    path.join(root, "native/tests/screen-context-test.m"), "-o", test]);
  const matrix = JSON.parse(execFileSync(test, { encoding: "utf8", timeout: 20_000, maxBuffer: 2_000_000 }));
  const modulePath = path.join(temp, "pipeline.mjs");
  await build({ stdin: { contents: [
    'export { normalizeTranscript, prepareTranscriptPostprocessing } from "./src/main/transcriptPostprocessing";',
    'export { ScreenContextSession } from "./src/main/screenContextSession";',
    'export { ContextDebugStore } from "./src/main/contextDebugStore";',
    'export { editLearningCandidate } from "./src/main/editLearningCandidate";',
  ].join("\n"), resolveDir: root }, outfile: modulePath, bundle: true, platform: "node", format: "esm" });
  const { normalizeTranscript, prepareTranscriptPostprocessing, ScreenContextSession, ContextDebugStore, editLearningCandidate } = await import(pathToFileURL(modulePath).href);
  const store = new ContextDebugStore(output);
  await store.start("Synthetic DFlash2 pipeline checks", !!process.argv[4]);
  const session = new ScreenContextSession();
  const raw = process.argv[3] ? JSON.parse(await fs.readFile(process.argv[3], "utf8")).results[0].raw : "Use D flash two for this project.";
  const expected = raw.replace(/D flash(?: two|2)/u, "DFlash2");
  assert.ok(expected.includes("DFlash2"), "Probe input must include D flash two or D flash2");
  const rows = [];
  for (const [index, sample] of matrix.cases.entries()) {
    const id = `fixture-${index}`;
    store.begin(id, { synthetic: true, fontPoints: sample.fontPoints, scale: sample.scale, dark: sample.dark });
    store.record(id, "native-context", { synthetic: true, source: "ocr", app: "Synthetic OCR fixture", ocr: sample.ocr });
    store.image(id, sample.png);
    session.begin(id);
    session.accept(id, sample.ocr.selectedTerms);
    session.freeze(id);
    const dictionary = session.read(id);
    prepareTranscriptPostprocessing(dictionary);
    store.record(id, "decode-request", { family: "parakeet", syntheticAudio: !!process.argv[3], screenTerms: dictionary });
    const trace = [];
    const start = performance.now();
    const corrected = normalizeTranscript(raw, "parakeet", dictionary, trace);
    const correctionMs = performance.now() - start;
    store.record(id, "correction", { raw, corrected, dictionary, trace });
    assert.equal(session.accept(id, ["StaleName"]), false, "Frozen context accepted a late result");
    session.end(id);
    assert.deepEqual(session.read(id), [], "Context leaked into the next dictation");
    if (sample.scale === 1.5) assert.equal(corrected, expected, "OCR to final text failed at fixture scale");
    const overview = await store.overview();
    await store.annotate(overview.setId, id, expected, "Synthetic fixture. No live screen capture or paste. 1x small dark text is an accuracy probe.");
    rows.push({ fontPoints: sample.fontPoints, scale: sample.scale, dark: sample.dark, ocrMs: sample.ms, correctionMs, passed: corrected === expected, corrected });
  }
  assert.deepEqual(editLearningCandidate("Use D flash two.", "Use DFlash2.", ["DFlash2"]), { from: "D flash two", to: "DFlash2" });
  assert.equal(editLearningCandidate("Use DFlash3.", "Use DFlash2.", ["DFlash2"]), null);
  if (process.argv[4]) {
    const wav = await fs.readFile(process.argv[4]);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt16LE(34), 16);
    // Locate the data chunk; WAV files can contain other chunks before it.
    let offset = 12;
    while (offset + 8 <= wav.length && wav.toString("ascii", offset, offset + 4) !== "data")
      offset += 8 + wav.readUInt32LE(offset + 4) + (wav.readUInt32LE(offset + 4) % 2);
    assert.ok(offset + 8 <= wav.length, "Missing WAV data");
    store.appendAudio("fixture-0", wav.subarray(offset + 8, offset + 8 + wav.readUInt32LE(offset + 4)));
    store.flushAudio("fixture-0");
  }
  store.stop();
  const overview = await store.overview();
  const reopened = new ContextDebugStore(output);
  assert.equal((await reopened.overview()).runs.length, matrix.cases.length);
  const report = { scope: "Synthetic OCR -> native name extraction -> session freeze -> real correction -> saved debug dataset. No live AX, microphone, or paste test.", set: store.folder(overview.setId), raw, expected, nameAssertions: matrix.nameAssertions, cases: rows };
  await fs.writeFile(path.join(store.folder(overview.setId), "pipeline-report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} finally {
  // Keep the default temporary output; remove only build files from named runs.
  if (output !== temp) await fs.rm(temp, { recursive: true, force: true });
}
