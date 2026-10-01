/** macOS only. Opens an owned scratch window; never uses a terminal or user document. */
import { build } from "esbuild";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "darwin")
  throw new Error("This benchmark requires macOS.");
const root = resolve(import.meta.dirname, "..");
const baseline = process.argv.includes("--baseline");
const samples = Number(process.env.SPOKE_PASTE_SAMPLES || 100);
if (!Number.isInteger(samples) || samples < 1 || samples > 1000)
  throw new Error("Use 1–1000 samples.");
const scratch = await mkdtemp(join(tmpdir(), "spoke-paste-bench-"));
let clipboardGuard;
try {
  const clipboardBinary = join(scratch, "clipboard-guard");
  execFileSync("clang", [
    "-fobjc-arc",
    "-framework",
    "AppKit",
    join(root, "scripts/fixtures/paste-clipboard.m"),
    "-o",
    clipboardBinary,
  ]);
  clipboardGuard = spawn(clipboardBinary, [], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    clipboardGuard.stdout.once("data", resolve);
    clipboardGuard.once("error", reject);
  });
  let helper = join(
    root,
    "native/bin/Spoke Helper.app/Contents/MacOS/Spoke Helper",
  );
  const source = (path) =>
    execFileSync("git", ["show", `origin/main:${path}`], {
      cwd: root,
      encoding: "utf8",
    });
  if (baseline) {
    const native = join(scratch, "helper.c");
    const bundleRoot = join(scratch, "Spoke Helper.app", "Contents");
    await mkdir(join(bundleRoot, "MacOS"), { recursive: true });
    await writeFile(
      join(bundleRoot, "Info.plist"),
      source("native/bin/Spoke Helper.app/Contents/Info.plist"),
    );
    helper = join(bundleRoot, "MacOS", "Spoke Helper");
    await writeFile(native, source("native/spoke-helper.c"));
    execFileSync("clang", [
      "-x",
      "objective-c",
      "-fobjc-arc",
      "-framework",
      "Foundation",
      "-framework",
      "AppKit",
      "-framework",
      "ApplicationServices",
      "-framework",
      "IOKit",
      "-framework",
      "CoreGraphics",
      native,
      "-o",
      helper,
    ]);
  }
  const bundle = join(scratch, "pipeline.cjs");
  await build({
    stdin: {
      contents:
        "export {insertTextAtCursor} from './pasteOrchestrator';export * from './pasteDaemon';",
      resolveDir: join(root, "src/main"),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: bundle,
    plugins: [
      {
        name: "scratch-environment",
        setup(b) {
          b.onResolve({ filter: /helperPaths$/ }, () => ({
            path: "helper",
            namespace: "scratch",
          }));
          b.onResolve({ filter: /windowState$/ }, () => ({
            path: "state",
            namespace: "scratch",
          }));
          b.onLoad({ filter: /.*/, namespace: "scratch" }, (args) => ({
            loader: "js",
            contents:
              args.path === "helper"
                ? `export const getHelperPath=()=>${JSON.stringify(helper)};`
                : "export const state={appPreferences:{autoSpace:true,vocabularyDictionary:Array.from({length:1000},(_,i)=>'BenchmarkWord'+i)},mainWindow:null};",
          }));
          if (baseline)
            b.onLoad(
              {
                filter:
                  /\/(pasteOrchestrator|pasteDaemon|selectionInspect)\.ts$/,
              },
              (args) => ({
                loader: "ts",
                contents: source(args.path.slice(root.length + 1)),
              }),
            );
        },
      },
    ],
  });
  await mkdir(join(root, "research"), { recursive: true });
  const child = spawn(
    join(root, "node_modules/.bin/electron"),
    [join(root, "scripts/fixtures/paste-benchmark.cjs")],
    {
      env: {
        ...process.env,
        SPOKE_PASTE_BUNDLE: bundle,
        SPOKE_PASTE_PROFILE: join(scratch, "profile"),
        SPOKE_PASTE_SAMPLES: String(samples),
        SPOKE_PASTE_BASELINE: baseline ? "1" : "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let buffer = "",
    result;
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.startsWith("BENCH_RESULT:")) result = JSON.parse(line.slice(13));
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0 || !result || result.error)
    throw new Error(result?.error || `Benchmark exited ${code}`);
  result.source = baseline
    ? execFileSync("git", ["rev-parse", "origin/main"], {
        cwd: root,
        encoding: "utf8",
      }).trim()
    : execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
  result.timestamp = new Date().toISOString();
  await writeFile(
    join(
      root,
      `research/paste-${baseline ? "baseline" : "current"}-electron.json`,
    ),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result.summary, null, 2));
} finally {
  if (clipboardGuard) {
    clipboardGuard.stdin.end();
    await new Promise((resolve) => clipboardGuard.once("exit", resolve));
  }
  await rm(scratch, { recursive: true, force: true });
}
