import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const pythonPath = path.join(
  projectRoot,
  "local-stt",
  ".venv",
  "bin",
  "python",
);
const requirementsPath = path.join(
  projectRoot,
  "local-stt",
  "requirements.txt",
);
const requirementsStampPath = path.join(
  projectRoot,
  "local-stt",
  ".venv",
  ".spoke-requirements-sha256",
);
const optional = process.argv.includes("--optional");

const requiredModules = [
  "mlx",
  "mlx_audio",
  "mlx_speech",
  "mlx_whisper",
  "numpy",
  "parakeet_mlx",
];

function fail(message) {
  console.error(`[STT setup] ${message}`);
  process.exit(1);
}

if (!existsSync(pythonPath)) {
  const message =
    "Python environment is missing. Create local-stt/.venv, then run npm run setup:stt.";
  if (optional) {
    console.warn(`[STT setup] ${message}`);
    process.exit(0);
  }
  fail(message);
}

const requirementsHash = createHash("sha256")
  .update(readFileSync(requirementsPath))
  .digest("hex");
const installedRequirementsHash = existsSync(requirementsStampPath)
  ? readFileSync(requirementsStampPath, "utf8").trim()
  : "";

const probeSource = [
  "import importlib.util",
  `modules = ${JSON.stringify(requiredModules)}`,
  "missing = [name for name in modules if importlib.util.find_spec(name) is None]",
  "print('\\n'.join(missing))",
  "raise SystemExit(1 if missing else 0)",
].join("\n");

function probeRuntime() {
  return spawnSync(pythonPath, ["-c", probeSource], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

const initialProbe = probeRuntime();
if (initialProbe.error) {
  fail(`Could not inspect the Python environment: ${initialProbe.error.message}`);
}

if (
  initialProbe.status !== 0 ||
  installedRequirementsHash !== requirementsHash
) {
  const missing = initialProbe.stdout.trim().split("\n").filter(Boolean);
  const reason = missing.length
    ? `missing modules: ${missing.join(", ")}`
    : "requirements changed";
  console.log(`[STT setup] Synchronizing Python dependencies (${reason}).`);
  const install = spawnSync(
    pythonPath,
    ["-m", "pip", "install", "-r", requirementsPath],
    { cwd: projectRoot, stdio: "inherit" },
  );
  if (install.error) {
    fail(`Could not install Python dependencies: ${install.error.message}`);
  }
  if (install.status !== 0) {
    fail(`Python dependency installation exited with code ${install.status}.`);
  }
  writeFileSync(requirementsStampPath, `${requirementsHash}\n`);
}

const finalProbe = probeRuntime();
if (finalProbe.error) {
  fail(`Could not verify the Python environment: ${finalProbe.error.message}`);
}
if (finalProbe.status !== 0) {
  const missing = finalProbe.stdout.trim().split("\n").filter(Boolean);
  fail(`Python dependencies are still missing: ${missing.join(", ")}.`);
}

console.log("[STT setup] Python dependencies ready.");
