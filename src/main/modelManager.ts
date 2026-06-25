/**
 * Model Manager
 *
 * Manages downloading, verifying, and the lifecycle of the local ASR models.
 * Multiple models can be installed side by side; one is "active" (used by the
 * sidecar). Weights live in `userData/local-stt/weights/<family>/` and state is
 * persisted to `userData/local-stt/model-state.json`.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import https from "node:https";
import http from "node:http";
import { getLocalSttDir, getWeightsDir } from "./sidecarPaths";
import {
  DEFAULT_MODEL_ID,
  getModelEntry,
  isKnownModelId,
  LOCAL_MODEL_IDS,
  LOCAL_MODEL_MANIFEST_VERSION,
  LOCAL_MODELS,
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

type InstalledModelFile = Pick<
  ModelManifestFile,
  "role" | "path" | "sha256" | "size"
>;

type PersistedModelEntry = {
  state: ModelInstallState;
  family: ModelStatus["family"];
  modelId: string;
  displayName: string | null;
  version: string | null;
  manifestVersion: number | null;
  files: InstalledModelFile[];
  error: string | null;
};

type PersistedState = {
  activeModelId: string;
  models: Record<string, PersistedModelEntry>;
};

// ── Callbacks ─────────────────────────────────────────────────────────

export interface ModelManagerCallbacks {
  onStatusChange: (status: ModelStatus) => void;
  onDownloadProgress: (progress: {
    modelId: string;
    progress: number;
    downloadedBytes: number;
    totalBytes: number;
  }) => void;
}

// ── Internal state ────────────────────────────────────────────────────

let activeModelId: string = DEFAULT_MODEL_ID;
const statuses = new Map<string, ModelStatus>();
const installedFiles = new Map<string, InstalledModelFile[]>();

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

function getTmpDir(family: string): string {
  return path.join(getLocalSttDir(), ".tmp", family);
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

function manifestFor(modelId: string): ModelManifest {
  const entry = getModelEntry(modelId);
  if (!entry) throw new Error(`Unknown model '${modelId}'.`);
  return {
    ...entry.manifest,
    files: entry.manifest.files.map((file) => ({ ...file })),
  };
}

function defaultStatus(modelId: string): ModelStatus {
  const entry = getModelEntry(modelId);
  if (!entry) throw new Error(`Unknown model '${modelId}'.`);
  const { manifest } = entry;
  return {
    state: "not_installed",
    family: manifest.family,
    modelId: manifest.modelId,
    displayName: manifest.displayName,
    version: manifest.version,
    manifestVersion: manifest.manifestVersion,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: totalFileSize(manifest.files),
    error: null,
  };
}

function setStatus(modelId: string, partial: Partial<ModelStatus>): void {
  const current = statuses.get(modelId) ?? defaultStatus(modelId);
  const next = { ...current, ...partial };
  statuses.set(modelId, next);
  try {
    callbacks.onStatusChange(next);
  } catch {}
}

function persistState(): void {
  try {
    const dir = getLocalSttDir();
    fs.mkdirSync(dir, { recursive: true });
    const models: Record<string, PersistedModelEntry> = {};
    for (const modelId of LOCAL_MODEL_IDS) {
      const status = statuses.get(modelId) ?? defaultStatus(modelId);
      models[modelId] = {
        state: status.state,
        family: status.family,
        modelId,
        displayName: status.displayName,
        version: status.version,
        manifestVersion: status.manifestVersion,
        files: installedFiles.get(modelId) ?? [],
        error: status.error,
      };
    }
    const persisted: PersistedState = { activeModelId, models };
    fs.writeFileSync(getStatePath(), JSON.stringify(persisted, null, 2));
  } catch (error) {
    console.error("[ModelManager] Failed to persist state:", error);
  }
}

function loadPersistedState(): PersistedState | null {
  try {
    const statePath = getStatePath();
    if (!fs.existsSync(statePath)) return null;
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return migratePersistedState(raw);
  } catch (error) {
    console.error("[ModelManager] Failed to load persisted state:", error);
    return null;
  }
}

/**
 * Accepts either the new multi-model shape `{ activeModelId, models }` or the
 * legacy single-model shape (a flat ModelStatus-like object) and normalizes to
 * the new shape.
 */
function migratePersistedState(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (obj.models && typeof obj.models === "object") {
    return {
      activeModelId:
        typeof obj.activeModelId === "string" &&
        isKnownModelId(obj.activeModelId)
          ? obj.activeModelId
          : DEFAULT_MODEL_ID,
      models: obj.models as Record<string, PersistedModelEntry>,
    };
  }

  // Legacy single-model state: lift it into the new map under its modelId.
  if (typeof obj.state === "string" && typeof obj.modelId === "string") {
    const legacy = obj as unknown as PersistedModelEntry;
    return {
      activeModelId: isKnownModelId(legacy.modelId)
        ? legacy.modelId
        : DEFAULT_MODEL_ID,
      models: { [legacy.modelId]: legacy },
    };
  }

  return null;
}

/**
 * Pre-multi-model builds stored Whisper weights directly in `weights/`. Move
 * them into `weights/whisper/` so they survive the layout change instead of
 * forcing a re-download.
 */
function migrateLegacyWhisperWeights(): void {
  try {
    const legacyDir = getWeightsDir();
    const targetDir = getWeightsDir("whisper");
    const marker = path.join(legacyDir, "weights.safetensors");
    if (!fs.existsSync(marker) || fs.existsSync(targetDir)) return;

    fs.mkdirSync(targetDir, { recursive: true });
    for (const name of fs.readdirSync(legacyDir)) {
      const src = path.join(legacyDir, name);
      if (!fs.statSync(src).isFile()) continue;
      fs.renameSync(src, path.join(targetDir, name));
    }
    console.log("[ModelManager] Migrated legacy Whisper weights to weights/whisper");
  } catch (error) {
    console.error("[ModelManager] Legacy weights migration failed:", error);
  }
}

function getReadyStateValidationError(
  modelId: string,
  persisted: PersistedModelEntry,
): string | null {
  const entry = getModelEntry(modelId);
  if (!entry) return "Installed model is no longer supported.";

  if (persisted.family !== entry.manifest.family) {
    return "Installed model family does not match the expected model.";
  }
  if (persisted.manifestVersion !== LOCAL_MODEL_MANIFEST_VERSION) {
    return "Installed model manifest version is unsupported.";
  }
  if (!Array.isArray(persisted.files) || persisted.files.length === 0) {
    return "Installed model file manifest is missing.";
  }

  const persistedPaths = new Set(persisted.files.map((file) => file.path));
  for (const requiredPath of entry.requiredFilePaths) {
    if (!persistedPaths.has(requiredPath)) {
      return `Installed model file '${requiredPath}' is missing from the manifest.`;
    }
  }

  const weightsDir = getWeightsDir(entry.manifest.family);
  for (const file of persisted.files) {
    if (!fs.existsSync(safeJoin(weightsDir, file.path))) {
      return "Model files missing from disk";
    }
  }

  return null;
}

function cleanupTmp(family: string): void {
  try {
    const tmpDir = getTmpDir(family);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
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
    stream.on("end", () => resolve(hash.digest("hex") === expectedHash));
    stream.on("error", reject);
  });
}

// ── File download with progress ───────────────────────────────────────

export function resolveDownloadRedirectUrl(
  location: string,
  currentUrl: string,
): string {
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    throw new Error(`Invalid redirect URL '${location}' from '${currentUrl}'`);
  }
}

function getDownloadClient(url: string): typeof https.get | typeof http.get {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid model file URL '${url}'`);
  }

  if (parsedUrl.protocol === "https:") return https.get;
  if (parsedUrl.protocol === "http:") return http.get;
  throw new Error(
    `Unsupported model file URL protocol '${parsedUrl.protocol}'`,
  );
}

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

    let get: typeof https.get | typeof http.get;
    try {
      get = getDownloadClient(url);
    } catch (error) {
      reject(error);
      return;
    }

    get(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        let redirectUrl: string;
        try {
          redirectUrl = resolveDownloadRedirectUrl(res.headers.location, url);
        } catch (error) {
          reject(error);
          res.resume();
          return;
        }

        res.resume();
        downloadFile(redirectUrl, destPath, onProgress, redirectCount + 1)
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

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
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

  migrateLegacyWhisperWeights();

  const persisted = loadPersistedState();
  activeModelId =
    persisted && isKnownModelId(persisted.activeModelId)
      ? persisted.activeModelId
      : DEFAULT_MODEL_ID;

  for (const modelId of LOCAL_MODEL_IDS) {
    cleanupTmp(getModelEntry(modelId)!.manifest.family);
    const saved = persisted?.models?.[modelId];

    if (saved && saved.state === "ready") {
      const validationError = getReadyStateValidationError(modelId, saved);
      if (!validationError) {
        installedFiles.set(modelId, saved.files ?? []);
        statuses.set(modelId, {
          ...defaultStatus(modelId),
          state: "ready",
          totalBytes: totalFileSize(saved.files ?? []),
          downloadedBytes: totalFileSize(saved.files ?? []),
          downloadProgress: 1,
        });
        continue;
      }
      console.log(
        `[ModelManager] ${modelId} marked ready but invalid:`,
        validationError,
      );
      installedFiles.set(modelId, []);
      statuses.set(modelId, {
        ...defaultStatus(modelId),
        state: "broken",
        error: validationError,
      });
      continue;
    }

    if (saved && saved.state === "broken") {
      installedFiles.set(modelId, saved.files ?? []);
      statuses.set(modelId, {
        ...defaultStatus(modelId),
        state: "broken",
        error: saved.error ?? "Unknown error",
      });
      continue;
    }

    // not_installed, or interrupted downloading/installing -> not_installed
    installedFiles.set(modelId, []);
    statuses.set(modelId, defaultStatus(modelId));
  }

  persistState();

  for (const status of statuses.values()) {
    callbacks.onStatusChange(status);
  }
  console.log(
    "[ModelManager] Initialized. Active:",
    activeModelId,
    "states:",
    LOCAL_MODEL_IDS.map((id) => `${id}=${statuses.get(id)?.state}`).join(", "),
  );
}

// ── State accessors ───────────────────────────────────────────────────

function resolveModelId(modelId?: string): string {
  return modelId ?? activeModelId;
}

export function getModelStatus(modelId?: string): ModelStatus {
  const id = resolveModelId(modelId);
  return { ...(statuses.get(id) ?? defaultStatus(id)) };
}

export function getAllModelStatuses(): ModelStatus[] {
  return LOCAL_MODEL_IDS.map((id) => ({
    ...(statuses.get(id) ?? defaultStatus(id)),
  }));
}

export function getModelInstallState(modelId?: string): ModelInstallState {
  return getModelStatus(modelId).state;
}

export function getActiveModelId(): string {
  return activeModelId;
}

export function setActiveModelId(modelId: string): void {
  if (!isKnownModelId(modelId)) {
    throw new Error(`Cannot activate unknown model '${modelId}'.`);
  }
  if (modelId === activeModelId) return;
  activeModelId = modelId;
  persistState();
  // Re-emit so listeners can recompute which model is active.
  callbacks.onStatusChange(getModelStatus(modelId));
}

// ── Install ───────────────────────────────────────────────────────────

export async function installModel(modelId?: string): Promise<void> {
  const id = resolveModelId(modelId);
  const current = statuses.get(id) ?? defaultStatus(id);
  if (current.state === "downloading" || current.state === "installing") {
    throw new Error("Install already in progress");
  }

  const entry = getModelEntry(id);
  if (!entry) throw new Error(`Unknown model '${id}'.`);
  const family = entry.manifest.family;
  const tmpDir = getTmpDir(family);
  const weightsDir = getWeightsDir(family);
  const manifest = manifestFor(id);
  const totalSize = totalFileSize(manifest.files);

  try {
    installedFiles.set(id, []);
    setStatus(id, {
      state: "downloading",
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: totalSize,
      error: null,
    });
    persistState();

    let totalDownloaded = 0;
    const completedFileBytes = new Map<string, number>();

    for (const file of manifest.files) {
      const tmpPath = safeJoin(tmpDir, file.path);
      const completedBeforeFile = [...completedFileBytes.values()].reduce(
        (total, bytes) => total + bytes,
        0,
      );
      await downloadFile(file.url, tmpPath, (downloadedBytes) => {
        totalDownloaded = completedBeforeFile + downloadedBytes;
        const progress = totalSize > 0 ? totalDownloaded / totalSize : 0;
        setStatus(id, {
          downloadProgress: Math.min(progress, 1),
          downloadedBytes: totalDownloaded,
          totalBytes: totalSize,
        });
        callbacks.onDownloadProgress({
          modelId: id,
          progress: Math.min(progress, 1),
          downloadedBytes: totalDownloaded,
          totalBytes: totalSize,
        });
      });
      completedFileBytes.set(file.path, file.size);
    }

    setStatus(id, { state: "installing", downloadProgress: 1 });
    persistState();

    for (const file of manifest.files) {
      const tmpPath = safeJoin(tmpDir, file.path);
      if (!(await verifySha256(tmpPath, file.sha256))) {
        throw new Error(`Checksum mismatch for '${file.path}'`);
      }
    }

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

    cleanupTmp(family);

    installedFiles.set(
      id,
      manifest.files.map(({ role, path: p, sha256, size }) => ({
        role,
        path: p,
        sha256,
        size,
      })),
    );

    setStatus(id, {
      state: "ready",
      downloadProgress: 1,
      downloadedBytes: totalSize,
      totalBytes: totalSize,
      error: null,
    });
    persistState();
    console.log(`[ModelManager] ${id} installed successfully`);
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error(`[ModelManager] Install failed for ${id}:`, msg);
    installedFiles.set(id, []);
    setStatus(id, {
      state: "broken",
      error: msg,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: totalSize,
    });
    persistState();
    cleanupTmp(family);
  }
}

// ── Remove ────────────────────────────────────────────────────────────

export async function removeModel(modelId?: string): Promise<void> {
  const id = resolveModelId(modelId);
  const current = statuses.get(id) ?? defaultStatus(id);
  if (current.state === "downloading" || current.state === "installing") {
    throw new Error("Cannot remove model while install is in progress");
  }

  const entry = getModelEntry(id);
  if (!entry) throw new Error(`Unknown model '${id}'.`);
  const family = entry.manifest.family;
  const weightsDir = getWeightsDir(family);

  try {
    if (fs.existsSync(weightsDir)) {
      fs.rmSync(weightsDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.error("[ModelManager] Failed to remove weights:", error);
  }

  cleanupTmp(family);

  installedFiles.set(id, []);
  statuses.set(id, defaultStatus(id));

  // If we just removed the active model, promote another installed model so we
  // don't leave `activeModelId` pointing at a now-uninstalled model (a dead end
  // where transcription breaks even though another installed model exists).
  if (id === activeModelId) {
    const promoted =
      LOCAL_MODEL_IDS.find(
        (candidate) =>
          candidate !== id && statuses.get(candidate)?.state === "ready",
      ) ?? DEFAULT_MODEL_ID;
    if (promoted !== activeModelId) {
      activeModelId = promoted;
    }
  }

  persistState();
  callbacks.onStatusChange(getModelStatus(id));
  // Re-emit the (possibly newly promoted) active model so listeners recompute.
  if (activeModelId !== id) {
    callbacks.onStatusChange(getModelStatus(activeModelId));
  }
  console.log(
    `[ModelManager] ${id} removed, reset to not_installed. Active: ${activeModelId}`,
  );
}
