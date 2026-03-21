/**
 * Model Manager
 *
 * Manages downloading, verifying, and lifecycle of local STT model weights.
 * Weights are stored in `userData/local-stt/weights/` and state is persisted
 * to `userData/local-stt/model-state.json`.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import https from "node:https";
import http from "node:http";
import { getLocalSttDir, getWeightsDir } from "./sidecarPaths";
import type {
  ModelInstallState,
  ModelManifest,
  ModelStatus,
} from "../types/shared";

// ── Constants ─────────────────────────────────────────────────────────

const MANIFEST_URL =
  "https://download.spoke.so/models/moonshine-v2/manifest.json";
const MAX_REDIRECTS = 5;
const STATE_FILE = "model-state.json";

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
  modelId: null,
  version: null,
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  error: null,
};

let modelStatus: ModelStatus = { ...DEFAULT_STATUS };

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
      modelId: modelStatus.modelId,
      version: modelStatus.version,
      error: modelStatus.error,
    };
    fs.writeFileSync(getStatePath(), JSON.stringify(persisted, null, 2));
  } catch (error) {
    console.error("[ModelManager] Failed to persist state:", error);
  }
}

function loadPersistedState(): Partial<ModelStatus> | null {
  try {
    const statePath = getStatePath();
    if (fs.existsSync(statePath)) {
      const data = fs.readFileSync(statePath, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("[ModelManager] Failed to load persisted state:", error);
  }
  return null;
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

// ── Manifest fetch ────────────────────────────────────────────────────

function fetchManifest(): Promise<ModelManifest> {
  return new Promise((resolve, reject) => {
    https
      .get(MANIFEST_URL, (res) => {
        const { statusCode } = res;
        if (!statusCode || statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP ${statusCode} fetching manifest`));
          res.resume();
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as ModelManifest);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
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
        fs.unlink(destPath, () => {});
        reject(err);
      });

      res.on("error", (err) => {
        fs.unlink(destPath, () => {});
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
    // Validate that weight files actually exist on disk
    const weightsDir = getWeightsDir();
    const weightsExist =
      fs.existsSync(path.join(weightsDir, "weights.safetensors")) &&
      fs.existsSync(path.join(weightsDir, "tokenizer.json"));

    if (weightsExist) {
      modelStatus = {
        ...DEFAULT_STATUS,
        state: "ready",
        modelId: persisted.modelId ?? null,
        version: persisted.version ?? null,
      };
    } else {
      console.log(
        "[ModelManager] State says ready but weight files are missing, marking broken",
      );
      modelStatus = {
        ...DEFAULT_STATUS,
        state: "broken",
        modelId: persisted.modelId ?? null,
        version: persisted.version ?? null,
        error: "Weight files missing from disk",
      };
      persistState();
    }
  } else if (persisted && persisted.state === "broken") {
    modelStatus = {
      ...DEFAULT_STATUS,
      state: "broken",
      modelId: persisted.modelId ?? null,
      version: persisted.version ?? null,
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
    modelStatus = { ...DEFAULT_STATUS };
    persistState();
  } else {
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
    console.log("[ModelManager] Install already in progress, ignoring");
    return;
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

    // Step 2: Fetch manifest
    console.log("[ModelManager] Fetching manifest...");
    const manifest = await fetchManifest();
    console.log(
      "[ModelManager] Manifest fetched:",
      manifest.modelId,
      manifest.version,
    );

    // Step 3: Download weights
    const weightsTmpPath = path.join(tmpDir, "weights.safetensors");
    const tokenizerTmpPath = path.join(tmpDir, "tokenizer.json");

    const totalSize = manifest.weightsSize + manifest.tokenizerSize;
    let totalDownloaded = 0;

    console.log("[ModelManager] Downloading weights...");
    await downloadFile(
      manifest.weightsUrl,
      weightsTmpPath,
      (downloadedBytes, _totalBytes) => {
        totalDownloaded = downloadedBytes;
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
      },
    );

    const weightsDownloaded = totalDownloaded;

    // Step 4: Download tokenizer
    console.log("[ModelManager] Downloading tokenizer...");
    await downloadFile(
      manifest.tokenizerUrl,
      tokenizerTmpPath,
      (downloadedBytes, _totalBytes) => {
        totalDownloaded = weightsDownloaded + downloadedBytes;
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
      },
    );

    // Step 5: Set state to installing
    setStatus({ state: "installing", downloadProgress: 1 });
    persistState();

    // Step 6: Verify SHA256 checksums
    console.log("[ModelManager] Verifying checksums...");
    const weightsValid = await verifySha256(
      weightsTmpPath,
      manifest.weightsChecksum,
    );
    if (!weightsValid) {
      throw new Error("Weights checksum mismatch");
    }

    const tokenizerValid = await verifySha256(
      tokenizerTmpPath,
      manifest.tokenizerChecksum,
    );
    if (!tokenizerValid) {
      throw new Error("Tokenizer checksum mismatch");
    }

    // Step 7: Create weights directory and move files atomically
    console.log("[ModelManager] Moving files to final location...");
    fs.mkdirSync(weightsDir, { recursive: true });
    fs.renameSync(weightsTmpPath, path.join(weightsDir, "weights.safetensors"));
    fs.renameSync(tokenizerTmpPath, path.join(weightsDir, "tokenizer.json"));

    // Step 8: Clean up .tmp
    cleanupTmp();

    // Step 9: Set state to ready
    setStatus({
      state: "ready",
      modelId: manifest.modelId,
      version: manifest.version,
      downloadProgress: 1,
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
    persistState();

    // Clean up .tmp on failure
    cleanupTmp();
  }
}

// ── Remove ────────────────────────────────────────────────────────────

export async function removeModel(): Promise<void> {
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
  modelStatus = { ...DEFAULT_STATUS };
  persistState();
  callbacks.onStatusChange(modelStatus);
  console.log("[ModelManager] Model removed, state reset to not_installed");
}
