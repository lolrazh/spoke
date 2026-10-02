/** Main pipeline in a Node host, separate owned Electron target; no renderer IPC. */
import electron from "electron";
import { build } from "esbuild";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
const dir = await mkdtemp(join(tmpdir(), "spoke-paste-production-"));
if (process.platform !== "darwin")
  throw new Error("This benchmark requires macOS.");
const suppressKeyPost = process.argv.includes("--no-key-post");
const queuedPaste = process.argv.includes("--queued-paste");
const forceNoAxFocus = process.argv.includes("--no-ax-focus");
const forceNoAxApp = process.argv.includes("--no-ax-app") || forceNoAxFocus;
const count = Number(process.env.SPOKE_PASTE_SAMPLES || 5);
if (!Number.isInteger(count) || count < 1 || count > 1000)
  throw new Error("Use 1–1000 samples.");
let target, secondTarget, api, clipboardGuard;
const savedInfo = console.info;
const report = {
  timestamp: new Date().toISOString(),
  runtime:
    "production main pipeline in Node host, separate Electron target; shared Node hrtime clock",
  samples: [],
  stages: [],
};
function client(p) {
  const q = [],
    wait = [];
  let buffer = "";
  p.stderr.on("data", (d) => process.stderr.write(d));
  p.stdout.on("data", (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.startsWith("{")) continue;
      const data = JSON.parse(line);
      if (wait.length) wait.shift()(data);
      else q.push(data);
    }
  });
  return {
    p,
    next: async () =>
      q.length
        ? q.shift()
        : new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              const index = wait.indexOf(receive);
              if (index >= 0) wait.splice(index, 1);
              reject(new Error("Target reply timeout"));
            }, 2000);
            const receive = (x) => {
              clearTimeout(timer);
              resolve(x);
            };
            wait.push(receive);
          }),
  };
}
const root = process.cwd();
let helperOverride = null;
try {
  if (forceNoAxApp || suppressKeyPost) {
    const contents = join(dir, "Spoke Helper.app", "Contents");
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await writeFile(
      join(contents, "Info.plist"),
      await readFile(
        resolve("native/bin/Spoke Helper.app/Contents/Info.plist"),
      ),
    );
    const source = await readFile(resolve("native/spoke-helper.c"), "utf8");
    const call =
      "AXUIElementCopyAttributeValue(sys, kAXFocusedApplicationAttribute, (CFTypeRef *)&appEl)";
    assert(source.includes(call), "Cannot install AX app failure fixture");
    const native = join(dir, "no-ax-app.c");
    let fixtureSource = forceNoAxApp
      ? source.replace(call, "kAXErrorFailure")
      : source;
    if (suppressKeyPost)
      fixtureSource = fixtureSource.replaceAll(
        "cmdVToPid(currentPid);",
        "(void)currentPid;",
      );
    if (forceNoAxFocus) {
      fixtureSource = fixtureSource.replace(
        "static bool g_debug_keys",
        "static AXError suppressedFocusLookup(void) { return kAXErrorFailure; }\nstatic bool g_debug_keys",
      );
      fixtureSource = fixtureSource.replaceAll(
        "AXUIElementCopyAttributeValue(appEl, kAXFocusedUIElementAttribute, (CFTypeRef *)&el)",
        "suppressedFocusLookup()",
      );
      report.forced_ax_field_failure = true;
    }
    await writeFile(native, fixtureSource);
    helperOverride = join(contents, "MacOS", "Spoke Helper");
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
      helperOverride,
    ]);
    report.forced_ax_app_failure = forceNoAxApp;
    report.suppressed_key_post = suppressKeyPost;
  }
  const clipboardBinary = join(dir, "clipboard-guard");
  execFileSync("clang", [
    "-fobjc-arc",
    "-framework",
    "AppKit",
    resolve("scripts/fixtures/paste-clipboard.m"),
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
  await build({
    stdin: {
      contents:
        "export {insertTextAtCursor} from './pasteOrchestrator';export {preSpawnPasteHelper,inspectViaPasteDaemon,insertViaPasteDaemon,pasteViaDaemon,killPasteDaemon} from './pasteDaemon';",
      resolveDir: resolve("src/main"),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(dir, "pipeline.mjs"),
    plugins: [
      {
        name: "fixture-environment",
        setup(b) {
          if (helperOverride) {
            b.onResolve({ filter: /helperPaths$/ }, () => ({
              path: "helper",
              namespace: "helper-fixture",
            }));
            b.onLoad({ filter: /.*/, namespace: "helper-fixture" }, () => ({
              contents: `export const getHelperPath=()=>${JSON.stringify(helperOverride)};`,
              loader: "js",
            }));
          }
          b.onLoad({ filter: /\/selectionInspect\.ts$/ }, async (args) => {
            const source = await readFile(args.path, "utf8");
            const declaration =
              "export async function inspectFocusedSelection(";
            if (!source.includes(declaration))
              throw new Error("Cannot install owned-target guard.");
            return {
              loader: "ts",
              contents:
                source.replace(
                  declaration,
                  "async function inspectOwnedFocusedSelection(",
                ) +
                `
              export async function inspectFocusedSelection(options){
                const selection=await inspectOwnedFocusedSelection(options);
                if(selection.targetPid!==Number(process.env.SPOKE_PASTE_OWNED_PID))throw new Error("Owned target lost focus");
                return selection;
              }`,
            };
          });
          b.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /windowState$/ }, () => ({
            path: "state",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents:
              args.path === "electron"
                ? `export const app={isPackaged:false,getAppPath:()=>${JSON.stringify(root)}};export const clipboard={writeText:()=>{throw new Error('Unexpected fallback')}};`
                : `export const state={appPreferences:{autoSpace:false,vocabularyDictionary:[]},mainWindow:null};`,
            loader: "js",
          }));
        },
      },
    ],
  });
  target = client(
    spawn(electron, [resolve("scripts/fixtures/paste-target.cjs")], {
      env: { ...process.env, SPOKE_PASTE_BENCH_PROFILE: join(dir, "profile") },
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
  const ready = await target.next();
  process.env.SPOKE_PASTE_OWNED_PID = String(ready.pid);
  await new Promise((r) => setTimeout(r, 400));
  api = await import(pathToFileURL(join(dir, "pipeline.mjs")));
  const prepareAt = performance.now();
  api.preSpawnPasteHelper();
  await api.inspectViaPasteDaemon(96);
  report.preparationMs = performance.now() - prepareAt;
  console.info = (...args) => {
    if (args[0] === "[Latency] Text insertion") report.stages.push(args[1]);
  };
  if (queuedPaste) {
    target.p.stdin.write('{"action":"stall"}\n');
    assert.equal((await target.next()).type, "stalling");
    const results = await Promise.all([
      api.insertTextAtCursor("First."),
      api.insertTextAtCursor("Second."),
    ]);
    assert.equal(results[0].success, true);
    assert.equal(results[1].success, !suppressKeyPost);
    await new Promise((resolve) => setTimeout(resolve, 100));
    target.p.stdin.write('{"action":"read"}\n');
    let final;
    do {
      final = await target.next();
    } while (final.type !== "read");
    assert.equal(final.text, suppressKeyPost ? "" : "First.Second.");
    if (suppressKeyPost) {
      api.killPasteDaemon();
      await new Promise((resolve) => setTimeout(resolve, 150));
      target.p.stdin.write('{"action":"read-clipboard"}\n');
      assert.equal((await target.next()).text, "First.");
    }
    report.summary = {
      queued_paste: true,
      suppressed_key_post: suppressKeyPost,
      results,
      text: final.text,
    };
  } else if (suppressKeyPost) {
    const receipt = await api.insertViaPasteDaemon(
      "SpokeBenchmark unread manual fallback.",
      ready.pid,
    );
    assert.equal(
      await receipt.clipboardRead,
      false,
      "Unsent paste was incorrectly confirmed",
    );
    target.p.stdin.write('{"action":"read"}\n');
    assert.equal(
      (await target.next()).text,
      "",
      "Suppressed keys changed the target",
    );
    api.killPasteDaemon();
    await new Promise((resolve) => setTimeout(resolve, 150));
    target.p.stdin.write('{"action":"read-clipboard"}\n');
    assert.equal(
      (await target.next()).text,
      "SpokeBenchmark unread manual fallback.",
    );
    report.unread_manual_fallback = true;
  } else {
    for (let i = 0; i < count; i++) {
      target.p.stdin.write('{"action":"reset","text":""}\n');
      await target.next();
      await new Promise((r) => setTimeout(r, 100));
      const startNs = process.hrtime.bigint();
      const start = performance.now();
      const result = await api.insertTextAtCursor("SpokeBenchmark Marble — λ.");
      const ms = performance.now() - start;
      assert(result.success, JSON.stringify(result));
      const receipt = await target.next();
      assert.equal(receipt.text, "SpokeBenchmark Marble — λ.");
      report.samples.push({
        ack_ms: ms,
        receipt_ms: (receipt.ns - Number(startNs)) / 1e6,
      });
    }
    function stats(key) {
      const v = report.samples.map((s) => s[key]).toSorted((a, b) => a - b);
      return {
        n: v.length,
        median_ms: v[Math.ceil(v.length * 0.5) - 1],
        p95_ms: v[Math.ceil(v.length * 0.95) - 1],
        max_ms: v.at(-1),
      };
    }
    if (!forceNoAxFocus) {
      const largeText =
        "SpokeBenchmark paragraph. ".repeat(3000) + "continue here ";
      target.p.stdin.write(
        JSON.stringify({ action: "reset", text: largeText }) + "\n",
      );
      await target.next();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const largeContext = await api.inspectViaPasteDaemon(96);
      assert.equal(
        Number(largeContext.match(/^targetPid:(\d+)$/m)?.[1]),
        ready.pid,
      );
      assert(
        largeContext.length < 2048,
        "Large document inspection returned unbounded data.",
      );
      const context = Buffer.from(
        largeContext.match(/^contextB64:(.*)$/m)?.[1] || "",
        "base64",
      ).toString("utf8");
      assert.equal(
        context,
        largeText.slice(-96),
        "Large document lost caret context.",
      );
      report.bounded_large_context = true;
      const selectedText = "It is a" + "x".repeat(50000) + ", indeed.";
      target.p.stdin.write(
        JSON.stringify({
          action: "reset",
          text: selectedText,
          start: 7,
          end: 50007,
        }) + "\n",
      );
      await target.next();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert((await api.insertTextAtCursor("Wonderful")).success);
      assert.equal((await target.next()).text, "It is a wonderful, indeed.");
      report.large_selection_boundaries = true;
    }

    // Keep the same helper while a different owned app takes focus. Verify that
    // Focus reads stay current even though the daemon blocks on stdin.
    secondTarget = client(
      spawn(electron, [resolve("scripts/fixtures/paste-target.cjs")], {
        env: {
          ...process.env,
          SPOKE_PASTE_BENCH_PROFILE: join(dir, "profile-second"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    const secondReady = await secondTarget.next();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const focus = await api.inspectViaPasteDaemon(96);
    assert.equal(
      Number(focus.match(/^targetPid:(\d+)$/m)?.[1]),
      secondReady.pid,
      "Persistent helper read stale app focus.",
    );
    await assert.rejects(api.pasteViaDaemon(ready.pid), /target changed/);
    report.app_focus_guard = true;
    report.summary = { ack: stats("ack_ms"), receipt: stats("receipt_ms") };
  }
  savedInfo(
    JSON.stringify(
      report.summary || {
        unread_manual_fallback: report.unread_manual_fallback,
      },
    ),
  );
} catch (error) {
  report.error = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  console.info = savedInfo;
  if (api) {
    await new Promise((r) => setTimeout(r, 650));
    api.killPasteDaemon();
  }
  if (secondTarget) {
    const exited = new Promise((resolve) =>
      secondTarget.p.once("exit", resolve),
    );
    secondTarget.p.stdin.write('{"action":"quit"}\n');
    await exited;
  }
  if (target) {
    const exited = new Promise((resolve) => target.p.once("exit", resolve));
    target.p.stdin.write('{"action":"quit"}\n');
    await exited;
  }
  if (clipboardGuard) {
    clipboardGuard.stdin.end();
    await new Promise((resolve) => clipboardGuard.once("exit", resolve));
  }
  await mkdir("research", { recursive: true });
  report.source = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  report.source_working_tree = Boolean(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      encoding: "utf8",
    }).trim(),
  );
  await writeFile(
    queuedPaste
      ? suppressKeyPost
        ? "research/paste-queued-unread-probe.json"
        : "research/paste-queued-busy-probe.json"
      : suppressKeyPost
        ? "research/paste-unread-probe.json"
        : forceNoAxFocus
          ? "research/paste-no-ax-focus-probe.json"
          : forceNoAxApp
            ? "research/paste-no-ax-app-probe.json"
            : "research/paste-external-production-probe.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
