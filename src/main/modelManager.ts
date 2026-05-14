/**
 * Model Manager
 *
 * Manages downloading, verifying, and lifecycle of the local Whisper model.
 * Weights are stored in `userData/local-stt/weights/` and state is persisted
 * to `userData/local-stt/model-state.json`.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import https from "node:https";
import http from "node:http";
import { getLocalSttDir, getWeightsDir } from "./sidecarPaths";
import {
  LOCAL_MODEL_DISPLAY_NAME,
  LOCAL_MODEL_FAMILY,
  LOCAL_MODEL_ID,
  LOCAL_MODEL_MANIFEST,
  LOCAL_MODEL_MANIFEST_VERSION,
  LOCAL_MODEL_REQUIRED_FILE_PATHS,
} from "./localModelContract";
import type {
  ModelInstallState,
  ModelManifest,
  ModelManifestFile,
  ModelStatus,
} from "../types/shared";

// ── Constants ─────────────────────────────────────────────────────────

const MAX_REDIRECTS = 5;
const STATE_FILE = "model-state.json";
const LOCAL_MODEL_TOTAL_BYTES = totalFileSize(LOCAL_MODEL_MANIFEST.files);

type InstalledModelFile = Pick<
  ModelManifestFile,
  "role" | "path" | "sha256" | "size"
>;

type PersistedModelState = Partial<ModelStatus> & {
  files?: InstalledModelFile[];
};

// ── Callbacks ─────────────────────────────────────────────────────────

export interface ModelManagerCallbacks {
  onStatusChange: (status: ModelStatus) => void;
  onDownloadProgress: (progress: {
    progress: number;
    downloadedBytes: number;
    totalBytes: number;
  }) => void;
}

// ── Internal state ────────────────────────────────────────────────────

const DEFAULT_STATUS: ModelStatus = {
  state: "not_installed",
  family: LOCAL_MODEL_FAMILY,
  modelId: LOCAL_MODEL_ID,
  displayName: LOCAL_MODEL_DISPLAY_NAME,
  version: LOCAL_MODEL_MANIFEST.version,
  manifestVersion: LOCAL_MODEL_MANIFEST_VERSION,
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: LOCAL_MODEL_TOTAL_BYTES,
  error: null,
};

let modelStatus: ModelStatus = { ...DEFAULT_STATUS };
let installedFiles: InstalledModelFile[] = [];

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};
let callbacks: ModelManagerCallbacks = {
  onStatusChange: noop,
  onDownloadProgress: noop,
};

// ── Helpers ───────────────────────────────────────────────────────────

function getStatePath(): string {
  return path.join(getLocalSttDir(), STATE_FILE);
}

function getTmpDir(): string {
  return path.join(getLocalSttDir(), ".tmp");
}

function safeJoin(root: string, relativePath: string): string {
  const normalized = path.normalize(relativePath);
  if (
    path.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Invalid model file path '${relativePath}'.`);
  }

  return path.join(root, normalized);
}

function totalFileSize(files: Pick<ModelManifestFile, "size">[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}

function setStatus(partial: Partial<ModelStatus>): void {
  modelStatus = { ...modelStatus, ...partial };
  try {
    callbacks.onStatusChange(modelStatus);
  } catch {}
}

function persistState(): void {
  try {
    const dir = getLocalSttDir();
    fs.mkdirSync(dir, { recursive: true });
    const persisted = {
      state: modelStatus.state,
      family: modelStatus.family,
      modelId: modelStatus.modelId,
      displayName: modelStatus.displayName,
      version: modelStatus.version,
      manifestVersion: modelStatus.manifestVersion,
      files: installedFiles,
      error: modelStatus.error,
    };
    fs.writeFileSync(getStatePath(), JSON.stringify(persisted, null, 2));
  } catch (error) {
    console.error("[ModelManager] Failed to persist state:", error);
  }
}

function loadPersistedState(): PersistedModelState | null {
  try {
    const statePath = getStatePath();
    if (fs.existsSync(statePath)) {
      const data = fs.readFileSync(statePath, "utf8");
      return JSON.parse(data) as PersistedModelState;
    }
  } catch (error) {
    console.error("[ModelManager] Failed to load persisted state:", error);
  }
  return null;
}

function getReadyStateValidationError(
  persisted: PersistedModelState,
): string | null {
  if (persisted.family !== LOCAL_MODEL_FAMILY) {
    return "Installed model family does not match the expected Whisper model.";
  }
  if (persisted.modelId !== LOCAL_MODEL_ID) {
    return "Installed model ID does not match the expected Whisper model.";
  }
  if (persisted.manifestVersion !== LOCAL_MODEL_MANIFEST_VERSION) {
    return "Installed model manifest version is unsupported.";
  }
  if (!Array.isArray(persisted.files) || persisted.files.length === 0) {
    return "Installed model file manifest is missing.";
  }

  const persistedPaths = new Set(persisted.files.map((file) => file.path));
  for (const requiredPath of LOCAL_MODEL_REQUIRED_FILE_PATHS) {
    if (!persistedPaths.has(requiredPath)) {
      return `Installed model file '${requiredPath}' is missing from the manifest.`;
    }
  }

  const weightsDir = getWeightsDir();
  for (const file of persisted.files) {
    const filePath = safeJoin(weightsDir, file.path);
    if (!fs.existsSync(filePath)) {
      return "Model files missing from disk";
    }
  }

  return null;
}

function assertManifest(manifest: ModelManifest): void {
  if (manifest.family !== LOCAL_MODEL_FAMILY) {
    throw new Error(`Unsupported model family '${manifest.family}'.`);
  }
  if (manifest.modelId !== LOCAL_MODEL_ID) {
    throw new Error(`Unsupported model ID '${manifest.modelId}'.`);
  }
  if (manifest.manifestVersion !== LOCAL_MODEL_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported model manifest version '${manifest.manifestVersion}'.`,
    );
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Model manifest does not list any files.");
  }

  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  for (const requiredPath of LOCAL_MODEL_REQUIRED_FILE_PATHS) {
    if (!manifestPaths.has(requiredPath)) {
      throw new Error(`Model manifest is missing '${requiredPath}'.`);
    }
  }
}

function cleanupTmp(): void {
  try {
    const tmpDir = getTmpDir();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log("[ModelManager] Cleaned up .tmp directory");
    }
  } catch (error) {
    console.error("[ModelManager] Failed to clean up .tmp:", error);
  }
}

// ── SHA256 verification ───────────────────────────────────────────────

function verifySha256(
  filePath: string,
  expectedHash: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => {
      const actual = hash.digest("hex");
      resolve(actual === expectedHash);
    });
    stream.on("error", reject);
  });
}

// ── Manifest access ───────────────────────────────────────────────────

function getManifest(): ModelManifest {
  return {
    ...LOCAL_MODEL_MANIFEST,
    files: LOCAL_MODEL_MANIFEST.files.map((file) => ({ ...file })),
  };
}

// ── File download with progress ───────────────────────────────────────

function downloadFile(
  url: string,
  destPath: string,
  onProgress: (downloadedBytes: number, totalBytes: number) => void,
  redirectCount = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error("Too many redirects"));
      return;
    }

    const get = url.startsWith("https:") ? https.get : http.get;

    get(url, (res) => {
      // Handle redirects
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        downloadFile(
          res.headers.location,
          destPath,
          onProgress,
          redirectCount + 1,
        )
          .then(resolve)
          .catch(reject);
        return;
      }

      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        res.resume();
        return;
      }

      const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
      let downloadedBytes = 0;

      const dir = path.dirname(destPath);
      fs.mkdirSync(dir, { recursive: true });

      const fileStream = fs.createWriteStream(destPath);

      res.on("data", (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        onProgress(downloadedBytes, totalBytes);
      });

      res.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close();
        resolve();
      });

      fileStream.on("error", (err) => {
        fs.unlink(destPath, () => undefined);
        reject(err);
      });

      res.on("error", (err) => {
        fs.unlink(destPath, () => undefined);
        reject(err);
      });
    }).on("error", reject);
  });
}

// ── Initialization ────────────────────────────────────────────────────

export function initModelManager(cbs: ModelManagerCallbacks): void {
  callbacks = cbs;

  // Clean up any leftover .tmp directory from interrupted downloads
  cleanupTmp();

  // Load persisted state
  const persisted = loadPersistedState();

  if (persisted && persisted.state === "ready") {
    const validationError = getReadyStateValidationError(persisted);

    if (!validationError) {
      installedFiles = persisted.files ?? [];
      modelStatus = {
        ...DEFAULT_STATUS,
        state: "ready",
        family: LOCAL_MODEL_FAMILY,
        modelId: LOCAL_MODEL_ID,
        displayName: persisted.displayName ?? LOCAL_MODEL_DISPLAY_NAME,
        version: persisted.version ?? null,
        manifestVersion: LOCAL_MODEL_MANIFEST_VERSION,
        totalBytes: totalFileSize(installedFiles),
        downloadedBytes: totalFileSize(installedFiles),
        downloadProgress: 1,
      };
    } else {
      console.log(
        "[ModelManager] State says ready but installed model is invalid, marking broken:",
        validationError,
      );
      installedFiles = [];
      modelStatus = {
        ...DEFAULT_STATUS,
        state: "broken",
        modelId: persisted.modelId ?? null,
        version: persisted.version ?? null,
        family: persisted.family ?? null,
        displayName: persisted.displayName ?? null,
        manifestVersion: persisted.manifestVersion ?? null,
        error: validationError,
      };
      persistState();
    }
  } else if (persisted && persisted.state === "broken") {
    installedFiles = persisted.files ?? [];
    modelStatus = {
      ...DEFAULT_STATUS,
      state: "broken",
      family: persisted.family ?? null,
      modelId: persisted.modelId ?? null,
      displayName: persisted.displayName ?? null,
      version: persisted.version ?? null,
      manifestVersion: persisted.manifestVersion ?? null,
      error: persisted.error ?? "Unknown error",
    };
  } else if (
    persisted &&
    (persisted.state === "downloading" || persisted.state === "installing")
  ) {
    // Interrupted mid-download/install — treat as not installed
    console.log(
      "[ModelManager] Interrupted install detected, resetting to not_installed",
    );
    installedFiles = [];
    modelStatus = { ...DEFAULT_STATUS };
    persistState();
  } else {
    installedFiles = [];
    modelStatus = { ...DEFAULT_STATUS };
  }

  callbacks.onStatusChange(modelStatus);
  console.log("[ModelManager] Initialized, state:", modelStatus.state);
}

// ── State accessors ───────────────────────────────────────────────────

export function getModelStatus(): ModelStatus {
  return { ...modelStatus };
}

export function getModelInstallState(): ModelInstallState {
  return modelStatus.state;
}

// ── Install ───────────────────────────────────────────────────────────

export async function installModel(): Promise<void> {
  // Guard against concurrent installs
  if (
    modelStatus.state === "downloading" ||
    modelStatus.state === "installing"
  ) {
    throw new Error("Install already in progress");
  }

  const tmpDir = getTmpDir();
  const weightsDir = getWeightsDir();

  try {
    // Step 1: Set state to downloading
    setStatus({
      state: "downloading",
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      error: null,
    });
    persistState();

    // Step 2: Load checked-in model manifest
    console.log("[ModelManager] Loading model manifest...");
    const manifest = getManifest();
    assertManifest(manifest);
    console.log(
      "[ModelManager] Manifest loaded:",
      manifest.modelId,
      manifest.version,
    );

    // Step 3: Download model files
    const totalSize = totalFileSize(manifest.files);
    let totalDownloaded = 0;
    const completedFileBytes = new Map<string, number>();

    for (const file of manifest.files) {
      console.log("[ModelManager] Downloading model file:", file.path);
      const tmpPath = safeJoin(tmpDir, file.path);
      const completedBeforeFile = [...completedFileBytes.values()].reduce(
        (total, bytes) => total + bytes,
        0,
      );
      await downloadFile(file.url, tmpPath, (downloadedBytes, _totalBytes) => {
        totalDownloaded = completedBeforeFile + downloadedBytes;
        const progress = totalSize > 0 ? totalDownloaded / totalSize : 0;
        setStatus({
          downloadProgress: Math.min(progress, 1),
          downloadedBytes: totalDownloaded,
          totalBytes: totalSize,
        });
        callbacks.onDownloadProgress({
          progress: Math.min(progress, 1),
          downloadedBytes: totalDownloaded,
          totalBytes: totalSize,
        });
      });
      completedFileBytes.set(file.path, file.size);
    }

    // Step 4: Set state to installing
    setStatus({ state: "installing", downloadProgress: 1 });
    persistState();

    // Step 5: Verify SHA256 checksums
    console.log("[ModelManager] Verifying checksums...");
    for (const file of manifest.files) {
      const tmpPath = safeJoin(tmpDir, file.path);
      const valid = await verifySha256(tmpPath, file.sha256);
      if (!valid) {
        throw new Error(`Checksum mismatch for '${file.path}'`);
      }
    }

    // Step 6: Create model directory and move files atomically
    console.log("[ModelManager] Moving files to final location...");
    if (fs.existsSync(weightsDir)) {
      fs.rmSync(weightsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(weightsDir, { recursive: true });
    for (const file of manifest.files) {
      const tmpPath = safeJoin(tmpDir, file.path);
      const finalPath = safeJoin(weightsDir, file.path);
      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      fs.renameSync(tmpPath, finalPath);
    }

    // Step 7: Clean up .tmp
    cleanupTmp();

    installedFiles = manifest.files.map(({ role, path, sha256, size }) => ({
      role,
      path,
      sha256,
      size,
    }));

    // Step 8: Set state to ready
    setStatus({
      state: "ready",
      family: manifest.family,
      modelId: manifest.modelId,
      displayName: manifest.displayName,
      version: manifest.version,
      manifestVersion: manifest.manifestVersion,
      downloadProgress: 1,
      downloadedBytes: totalSize,
      totalBytes: totalSize,
      error: null,
    });
    persistState();
    console.log("[ModelManager] Model installed successfully");
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error("[ModelManager] Install failed:", msg);

    setStatus({
      state: "broken",
      error: msg,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    });
    installedFiles = [];
    persistState();

    // Clean up .tmp on failure
    cleanupTmp();
  }
}

// ── Remove ────────────────────────────────────────────────────────────

export async function removeModel(): Promise<void> {
  // Guard against removal during active download/install
  if (
    modelStatus.state === "downloading" ||
    modelStatus.state === "installing"
  ) {
    throw new Error("Cannot remove model while install is in progress");
  }

  const weightsDir = getWeightsDir();

  try {
    if (fs.existsSync(weightsDir)) {
      fs.rmSync(weightsDir, { recursive: true, force: true });
      console.log("[ModelManager] Removed weights directory");
    }
  } catch (error) {
    console.error("[ModelManager] Failed to remove weights:", error);
  }

  // Clean up any tmp files too
  cleanupTmp();

  // Reset state
  installedFiles = [];
  modelStatus = { ...DEFAULT_STATUS };
  persistState();
  callbacks.onStatusChange(modelStatus);
  console.log("[ModelManager] Model removed, state reset to not_installed");
}
