import { build } from "esbuild";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

if (process.argv.includes("--electron") && !process.versions.electron) {
  const executable = (await import("electron")).default;
  const profile = await mkdtemp(
    path.join(os.tmpdir(), "spoke-benchmark-profile-"),
  );
  const environment = {
    ...process.env,
    SPOKE_BENCH_USER_DATA: profile,
    SPOKE_BENCH_OUTPUT:
      process.env.SPOKE_BENCH_OUTPUT ??
      "research/fast-postprocessing-electron.json",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const bootstrap = path.join(profile, "benchmark.cjs");
  await writeFile(
    bootstrap,
    `const {app} = require('electron');\napp.setPath('userData', process.env.SPOKE_BENCH_USER_DATA);\napp.whenReady().then(() => import(${JSON.stringify(pathToFileURL(path.resolve(process.argv[1])).href)})).catch(error => { console.error(error); app.exit(1); });\n`,
  );
  try {
    execFileSync(executable, [bootstrap, ...process.argv.slice(2)], {
      env: environment,
      stdio: "inherit",
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
  process.exit(0);
}
const electronApp = process.versions.electron
  ? (await import("electron")).app
  : null;
if (electronApp) {
  await electronApp.whenReady();
}

// Run from the repository root. --legacy also measures the real native engine.
// Check full outputs; require first final call and warm/fresh/stress p95 < 5 ms.
const root = process.cwd();
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "spoke-postprocessing-"),
);
const legacy = process.argv.includes("--legacy");
const stress = process.argv.includes("--stress");
const resultPath = path.resolve(
  process.env.SPOKE_BENCH_OUTPUT ?? "research/fast-postprocessing-latency.json",
);
const cases = JSON.parse(
  await readFile("scripts/postprocessing-corpus.json", "utf8"),
);
const dictionary = [
  "Sandheep",
  "Qwen",
  "AutoCAD",
  "Vercel",
  "skeumorphic",
  "GitHub",
];
const count = Number(process.env.SPOKE_BENCH_SAMPLES ?? 1000);
assert(Number.isInteger(count) && count >= 100);
const sink = { log: console.log, info: console.info, warn: console.warn };
let api;
let succeeded = false;

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.ceil(p * sorted.length) - 1];
  return {
    n: values.length,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: sorted.at(-1),
    over5ms: values.filter((v) => v > 5).length,
  };
}
function measure(operation) {
  const start = performance.now();
  const result = operation();
  return { ms: performance.now() - start, result };
}
const report = {
  timestamp: new Date().toISOString(),
  host: {
    cpu: os.cpus()[0].model,
    platform: process.platform,
    node: process.version,
    electron: process.versions.electron ?? null,
    chromium: process.versions.chrome ?? null,
  },
  method: {
    count,
    warmup: 50,
    dictionary,
    includes:
      "production normalization + cursor insertion formatting; cold dictionary indexes measured separately",
    excludes:
      "ASR, paste, Electron scheduling, console/file I/O; module startup reported separately",
  },
  cases: [],
};
try {
  let baseline = "";
  if (legacy) {
    const source = execFileSync(
      "git",
      [
        "show",
        "a6aa94a671d4ab0e14f9a6a9c1c6db86f1470741:src/main/localSttLifecycle.ts",
      ],
      { encoding: "utf8" },
    );
    const start = source.indexOf("async function normalizeTranscriptForModel(");
    const end = source.indexOf("\nfunction logSidecarShutdownFailure", start);
    assert(start >= 0 && end > start);
    baseline =
      "export " +
      source
        .slice(start, end)
        .replace("normalizeTranscriptForModel(", "normalizeLegacy(");
  }
  await build({
    stdin: {
      contents: `
        import { getModelFamily } from './localModelContract';
        export { normalizeTranscript, prepareTranscriptPostprocessing } from './transcriptPostprocessing';
        export { formatDictationForInsertion } from './contextualDictationFormatter';
        export { correctTranscript } from './dictionaryCorrection';
        ${baseline}
        ${legacy ? "export async function stopLegacy() { await (await import('./itnEngine')).killItn(); }" : ""}
      `,
      resolveDir: path.join(root, "src/main"),
      sourcefile: "benchmark.ts",
      loader: "ts",
    },
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    outdir: temporary,
    outExtension: { ".js": ".mjs" },
    plugins: [
      {
        name: "local-paths",
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "bench",
          }));
          builder.onLoad({ filter: /.*/, namespace: "bench" }, () => ({
            contents: `export const app = { isPackaged: false, getAppPath: () => ${JSON.stringify(root)} };`,
            loader: "js",
          }));
        },
      },
    ],
  });
  console.log = console.info = console.warn = () => {};
  const importedAt = performance.now();
  api = await import(pathToFileURL(path.join(temporary, "stdin.mjs")).href);
  report.moduleStartupMs = performance.now() - importedAt;
  const options = {
    autoSpace: true,
    dictionary,
    selection: {
      ok: true,
      range: { location: 9, length: 0 },
      context: "Previous sentence. Next sentence.",
    },
  };
  const pipeline = (text, vocab = dictionary) =>
    api.formatDictationForInsertion(
      api.normalizeTranscript(text, "parakeet", vocab),
      { ...options, dictionary: vocab },
    );
  report.preparationMs = measure(() =>
    api.prepareTranscriptPostprocessing(dictionary),
  ).ms;
  const cold = measure(() => pipeline(cases[1].text));
  report.firstCallMs = cold.ms;
  for (const sample of cases) {
    const expected = api.formatDictationForInsertion(sample.expected, options);
    assert.equal(
      pipeline(sample.text),
      expected,
      `${sample.name}: full output mismatch`,
    );
    for (let i = 0; i < 50; i++) pipeline(sample.text);
    const times = [];
    for (let i = 0; i < count; i++) {
      const timed = measure(() => pipeline(sample.text));
      assert.equal(timed.result, expected);
      times.push(timed.ms);
    }
    // This prevents cache-only measurements from hiding expensive first inputs.
    const freshIndexTimes = [];
    for (let i = 0; i < 100; i++) {
      const timed = measure(() => pipeline(sample.text, dictionary.slice()));
      assert.equal(timed.result, expected);
      freshIndexTimes.push(timed.ms);
    }
    const row = {
      name: sample.name,
      words: sample.text.trim().split(/\s+/u).length,
      chars: sample.text.length,
      output: api.normalizeTranscript(sample.text, "parakeet", dictionary),
      warm: summary(times),
      freshDictionary: summary(freshIndexTimes),
      samples: times,
    };
    if (legacy) {
      const nativeTimes = [];
      let nativeOutput;
      for (let i = 0; i < 20; i++) {
        const started = performance.now();
        nativeOutput = await api.normalizeLegacy(
          sample.text,
          "spokedotso/parakeet-tdt-0.6b-v2-mlx-6bit",
          dictionary,
        );
        nativeTimes.push(performance.now() - started);
      }
      row.legacy = summary(nativeTimes.slice(1));
      row.legacyOutput = nativeOutput;
    }
    report.cases.push(row);
    sink.log(
      sample.name,
      row.words,
      "words; p50/p95/p99:",
      row.warm.medianMs.toFixed(3),
      row.warm.p95Ms.toFixed(3),
      row.warm.p99Ms.toFixed(3),
      "ms; fresh dictionary p95:",
      row.freshDictionary.p95Ms.toFixed(3),
    );
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n");
  }
  report.p95Pass = report.firstCallMs < 5 && report.cases.every(
    (row) => row.warm.p95Ms < 5 && row.freshDictionary.p95Ms < 5,
  );
  if (stress) {
    const makeWord = (seed) => {
      let state = seed >>> 0;
      let value = "";
      const consonants = "bcdfghjklmnpqrstvwxyz";
      const vowels = "aeiou";
      for (let i = 0; i < 9; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const alphabet = i % 2 ? vowels : consonants;
        value += alphabet[state % alphabet.length];
      }
      return value;
    };
    report.stress = [];
    for (const size of [6, 100, 1000]) {
      const vocab = [
        ...dictionary,
        ...Array.from(
          { length: Math.max(0, size - dictionary.length) },
          (_, i) => makeWord(i + 1),
        ),
      ];
      const preparation = measure(() =>
        api.prepareTranscriptPostprocessing(vocab),
      );
      const times = [];
      for (let iteration = 0; iteration < 100; iteration++) {
        const text = `${cases[1].text} ${Array.from({ length: 100 }, (_, i) => makeWord(100000 + iteration * 100 + i)).join(" ")}`;
        times.push(measure(() => pipeline(text, vocab)).ms);
      }
      const row = {
        dictionarySize: size,
        words: 250,
        distinctInputs: 100,
        preparationMs: preparation.ms,
        timing: summary(times),
      };
      report.stress.push(row);
      sink.log(
        "Unique prose; dictionary",
        size,
        "p50/p95",
        row.timing.medianMs.toFixed(3),
        row.timing.p95Ms.toFixed(3),
        "ms; preparation",
        preparation.ms.toFixed(3),
        "ms",
      );
    }
    report.p95Pass &&= report.stress.every((row) => row.timing.p95Ms < 5);
  }
  report.maxFinalCallMs = Math.max(
    report.firstCallMs,
    ...report.cases.flatMap(row => [row.warm.maxMs, row.freshDictionary.maxMs]),
    ...(report.stress ?? []).map(row => row.timing.maxMs),
  );
  report.allMeasuredUnder5Ms = report.maxFinalCallMs < 5;
  await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n");
  sink.log(
    "Module startup:",
    report.moduleStartupMs.toFixed(3),
    "ms. First call:",
    report.firstCallMs.toFixed(3),
    "ms. All p95 < 5 ms:",
    report.p95Pass,
  );
  sink.log("Results:", resultPath);
  assert(report.p95Pass, "First final call or post-processing p95 exceeded 5 ms");
  succeeded = true;
} catch (error) {
  sink.warn(error);
  throw error;
} finally {
  if (api?.stopLegacy) await api.stopLegacy();
  Object.assign(console, sink);
  await rm(temporary, { recursive: true, force: true });
  if (electronApp) electronApp.exit(succeeded ? 0 : 1);
}
