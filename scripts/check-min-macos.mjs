// Fail if any Mach-O binary inside the packaged app needs a newer macOS than
// the app declares in LSMinimumSystemVersion. Native pieces (the helper, the
// MLX sidecar's dylibs) otherwise inherit the build machine's macOS silently,
// and users on an older supported macOS get an app that cannot run.
//
// Usage: node scripts/check-min-macos.mjs [path/to/Spoke.app]
import { execFileSync } from "node:child_process";
import { openSync, readSync, closeSync, readdirSync, lstatSync } from "node:fs";
import path from "node:path";

const app = process.argv[2] || "out/Spoke-darwin-arm64/Spoke.app";
const declared = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :LSMinimumSystemVersion", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim();

const MAGICS = new Set(["feedfacf", "cffaedfe", "feedface", "cefaedfe", "cafebabe", "bebafeca"]);
function isMachO(file) {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(4);
    return readSync(fd, buf, 0, 4, 0) === 4 && MAGICS.has(buf.toString("hex"));
  } finally {
    closeSync(fd);
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile() && st.size >= 4) yield p;
  }
}

const parse = (v) => v.split(".").map((n) => Number(n) || 0);
function newer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

// LC_BUILD_VERSION reports "minos X"; older binaries use LC_VERSION_MIN_MACOSX.
// vtool, not otool: otool reads "Name (GPU)" as an archive member and fails.
function minOs(file) {
  const out = execFileSync("vtool", ["-show-build", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let max = null;
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let v = null;
    if (line.startsWith("minos ")) v = line.slice(6).trim();
    else if (line === "cmd LC_VERSION_MIN_MACOSX") {
      const vl = lines.slice(i, i + 4).map((l) => l.trim()).find((l) => l.startsWith("version "));
      if (vl) v = vl.slice(8).trim();
    }
    if (v && (!max || newer(v, max))) max = v;
  }
  return max;
}

let checked = 0;
const offenders = [];
for (const file of walk(app)) {
  if (!isMachO(file)) continue;
  checked++;
  const v = minOs(file);
  if (v && newer(v, declared)) offenders.push([v, path.relative(app, file)]);
}

console.log(`[check-min-macos] ${checked} Mach-O files; declared minimum macOS ${declared}`);
if (offenders.length) {
  offenders.sort((a, b) => (newer(a[0], b[0]) ? -1 : 1));
  for (const [v, f] of offenders) console.error(`  needs macOS ${v}: ${f}`);
  console.error(`[check-min-macos] ${offenders.length} binaries need a newer macOS than ${declared}`);
  process.exit(1);
}
console.log("[check-min-macos] OK");
