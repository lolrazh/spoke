/**
 * Model Manager Tests
 *
 * Tests the multi-model state machine, persistence/migration, active-model
 * selection, and lifecycle. File I/O and Electron's `app` module are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── Mock sidecarPaths ─────────────────────────────────────────────────

const MOCK_LOCAL_STT_DIR = "/tmp/test-spoke/local-stt";
const MOCK_WEIGHTS_DIR = "/tmp/test-spoke/local-stt/weights";

vi.mock("./sidecarPaths", () => ({
  getLocalSttDir: () => MOCK_LOCAL_STT_DIR,
  // Family-agnostic in tests: every family resolves to the same dir so the
  // existence mocks below stay simple.
  getWeightsDir: () => MOCK_WEIGHTS_DIR,
}));

// ── Mock fs ───────────────────────────────────────────────────────────

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    renameSync: vi.fn(),
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
    unlink: vi.fn(),
  };
});

// ── Mock node:https ──────────────────────────────────────────────────

vi.mock("node:https", () => ({
  default: { get: vi.fn() },
}));

import https from "node:https";

// ── Import after mocks ───────────────────────────────────────────────

import {
  initModelManager,
  getModelStatus,
  getAllModelStatuses,
  getModelInstallState,
  getActiveModelId,
  setActiveModelId,
  removeModel,
  installModel,
  resolveDownloadRedirectUrl,
} from "./modelManager";
import type { ModelManagerCallbacks } from "./modelManager";
import {
  DEFAULT_MODEL_ID,
  LOCAL_MODEL_IDS,
  getModelEntry,
} from "./localModelContract";

// The default (active) model the no-arg accessors operate on.
const ENTRY = getModelEntry(DEFAULT_MODEL_ID)!;
const FAMILY = ENTRY.manifest.family;
const DISPLAY = ENTRY.manifest.displayName;
const VERSION = ENTRY.manifest.version;
const MANIFEST_VERSION = ENTRY.manifest.manifestVersion;
const INSTALLED_FILES = ENTRY.manifest.files.map((f) => ({
  role: f.role,
  path: f.path,
  sha256: f.sha256,
  size: f.size,
}));
const TOTAL_BYTES = INSTALLED_FILES.reduce((s, f) => s + f.size, 0);

// The "other" (non-default) model, for active-selection tests.
const OTHER_MODEL_ID = LOCAL_MODEL_IDS.find((id) => id !== DEFAULT_MODEL_ID)!;

// ── Helpers ───────────────────────────────────────────────────────────

function makeCallbacks(): ModelManagerCallbacks {
  return {
    onStatusChange: vi.fn(),
    onDownloadProgress: vi.fn(),
  };
}

function readyEntry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: "ready",
    family: FAMILY,
    modelId: DEFAULT_MODEL_ID,
    displayName: DISPLAY,
    version: VERSION,
    manifestVersion: MANIFEST_VERSION,
    files: INSTALLED_FILES,
    error: null,
    ...overrides,
  };
}

/** New multi-model persisted shape. */
function persisted(entry: Record<string, unknown>, modelId = DEFAULT_MODEL_ID) {
  return { activeModelId: DEFAULT_MODEL_ID, models: { [modelId]: entry } };
}

function mockState(state: Record<string, unknown>): void {
  const statePath = path.join(MOCK_LOCAL_STT_DIR, "model-state.json");
  (fs.existsSync as any).mockImplementation((p: string) => p === statePath);
  (fs.readFileSync as any).mockImplementation((p: string) =>
    p === statePath ? JSON.stringify(state) : "{}",
  );
}

function mockStateWithWeights(state: Record<string, unknown>): void {
  const statePath = path.join(MOCK_LOCAL_STT_DIR, "model-state.json");
  const installedPaths = new Set(
    INSTALLED_FILES.map((f) => path.join(MOCK_WEIGHTS_DIR, f.path)),
  );
  (fs.existsSync as any).mockImplementation(
    (p: string) => p === statePath || installedPaths.has(p),
  );
  (fs.readFileSync as any).mockImplementation((p: string) =>
    p === statePath ? JSON.stringify(state) : "{}",
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("modelManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as any).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initModelManager", () => {
    it("defaults every model to not_installed with no persisted state", () => {
      initModelManager(makeCallbacks());

      const status = getModelStatus();
      expect(status.state).toBe("not_installed");
      expect(status.modelId).toBe(DEFAULT_MODEL_ID);
      expect(status.displayName).toBe(DISPLAY);
      expect(status.version).toBe(VERSION);
      expect(status.totalBytes).toBeGreaterThan(0);
      expect(status.error).toBeNull();
    });

    it("emits a status change for every known model during init", () => {
      const cbs = makeCallbacks();
      initModelManager(cbs);

      expect(cbs.onStatusChange).toHaveBeenCalledTimes(LOCAL_MODEL_IDS.length);
      expect(cbs.onStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ state: "not_installed" }),
      );
    });

    it("activates the default model with no persisted state", () => {
      initModelManager(makeCallbacks());
      expect(getActiveModelId()).toBe(DEFAULT_MODEL_ID);
    });

    it("restores ready state when the model's files exist on disk", () => {
      mockStateWithWeights(persisted(readyEntry()));

      initModelManager(makeCallbacks());

      const status = getModelStatus();
      expect(status.state).toBe("ready");
      expect(status.family).toBe(FAMILY);
      expect(status.modelId).toBe(DEFAULT_MODEL_ID);
      expect(status.totalBytes).toBe(TOTAL_BYTES);
      expect(status.downloadedBytes).toBe(TOTAL_BYTES);
    });

    it("marks ready-but-missing files as broken", () => {
      mockState(persisted(readyEntry()));

      initModelManager(makeCallbacks());

      const status = getModelStatus();
      expect(status.state).toBe("broken");
      expect(status.error).toBe("Model files missing from disk");
    });

    it("marks a model with a mismatched family as broken even if files exist", () => {
      mockStateWithWeights(persisted(readyEntry({ family: "whisper-bogus" })));

      initModelManager(makeCallbacks());

      const status = getModelStatus();
      expect(status.state).toBe("broken");
      expect(status.error).toContain("family does not match");
    });

    it("restores a broken state with its error message", () => {
      mockState(
        persisted({
          state: "broken",
          family: FAMILY,
          modelId: DEFAULT_MODEL_ID,
          displayName: DISPLAY,
          manifestVersion: MANIFEST_VERSION,
          version: VERSION,
          error: "Checksum mismatch",
        }),
      );

      initModelManager(makeCallbacks());

      const status = getModelStatus();
      expect(status.state).toBe("broken");
      expect(status.error).toBe("Checksum mismatch");
      expect(status.modelId).toBe(DEFAULT_MODEL_ID);
    });

    it("migrates the legacy single-model state shape", () => {
      // Pre-multi-model builds stored a flat object (no `models` map).
      mockStateWithWeights(readyEntry());

      initModelManager(makeCallbacks());

      expect(getModelStatus().state).toBe("ready");
      expect(getActiveModelId()).toBe(DEFAULT_MODEL_ID);
    });

    it("resets an interrupted downloading state to not_installed", () => {
      mockState(persisted({ state: "downloading", modelId: DEFAULT_MODEL_ID }));

      initModelManager(makeCallbacks());

      expect(getModelStatus().state).toBe("not_installed");
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("resets an interrupted installing state to not_installed", () => {
      mockState(persisted({ state: "installing", modelId: DEFAULT_MODEL_ID }));

      initModelManager(makeCallbacks());

      expect(getModelStatus().state).toBe("not_installed");
    });

    it("cleans up leftover per-family .tmp directories on init", () => {
      const tmpDir = path.join(MOCK_LOCAL_STT_DIR, ".tmp", FAMILY);
      (fs.existsSync as any).mockImplementation((p: string) => p === tmpDir);

      initModelManager(makeCallbacks());

      expect(fs.rmSync).toHaveBeenCalledWith(tmpDir, {
        recursive: true,
        force: true,
      });
    });
  });

  describe("active model selection", () => {
    it("getAllModelStatuses returns one status per known model", () => {
      initModelManager(makeCallbacks());
      const all = getAllModelStatuses();
      expect(all.map((s) => s.modelId).sort()).toEqual(
        [...LOCAL_MODEL_IDS].sort(),
      );
    });

    it("setActiveModelId switches the active model and persists", () => {
      initModelManager(makeCallbacks());
      vi.mocked(fs.writeFileSync).mockClear();

      setActiveModelId(OTHER_MODEL_ID);

      expect(getActiveModelId()).toBe(OTHER_MODEL_ID);
      expect(getModelStatus().modelId).toBe(OTHER_MODEL_ID);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("rejects activating an unknown model", () => {
      initModelManager(makeCallbacks());
      expect(() => setActiveModelId("nope/not-a-model")).toThrow("unknown");
    });

    it("operates on a specific model when an id is passed", () => {
      initModelManager(makeCallbacks());
      expect(getModelStatus(OTHER_MODEL_ID).modelId).toBe(OTHER_MODEL_ID);
      expect(getModelInstallState(OTHER_MODEL_ID)).toBe("not_installed");
    });
  });

  describe("getModelStatus", () => {
    it("returns a copy, not a reference", () => {
      initModelManager(makeCallbacks());
      const a = getModelStatus();
      const b = getModelStatus();
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe("removeModel", () => {
    it("resets state to not_installed", async () => {
      mockStateWithWeights(persisted(readyEntry()));
      initModelManager(makeCallbacks());
      expect(getModelStatus().state).toBe("ready");

      await removeModel();

      const status = getModelStatus();
      expect(status.state).toBe("not_installed");
      expect(status.modelId).toBe(DEFAULT_MODEL_ID);
      expect(status.error).toBeNull();
    });

    it("deletes the weights directory", async () => {
      (fs.existsSync as any).mockImplementation(
        (p: string) => p === MOCK_WEIGHTS_DIR,
      );
      initModelManager(makeCallbacks());

      await removeModel();

      expect(fs.rmSync).toHaveBeenCalledWith(MOCK_WEIGHTS_DIR, {
        recursive: true,
        force: true,
      });
    });

    it("persists the reset state", async () => {
      initModelManager(makeCallbacks());
      vi.mocked(fs.writeFileSync).mockClear();

      await removeModel();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(MOCK_LOCAL_STT_DIR, "model-state.json"),
        expect.any(String),
      );
    });

    it("notifies via callback after removal", async () => {
      const cbs = makeCallbacks();
      initModelManager(cbs);
      vi.mocked(cbs.onStatusChange).mockClear();

      await removeModel();

      expect(cbs.onStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ state: "not_installed" }),
      );
    });
  });

  describe("installModel", () => {
    it("resolves Hugging Face relative redirect URLs", () => {
      const redirect = resolveDownloadRedirectUrl(
        "/api/resolve-cache/models/spokedotso/cohere-transcribe-03-2026-mlx-4bit/config.json?etag=test",
        "https://huggingface.co/spokedotso/cohere-transcribe-03-2026-mlx-4bit/resolve/revision/config.json",
      );
      expect(redirect).toBe(
        "https://huggingface.co/api/resolve-cache/models/spokedotso/cohere-transcribe-03-2026-mlx-4bit/config.json?etag=test",
      );
    });

    it("keeps absolute redirect URLs unchanged", () => {
      const redirect = resolveDownloadRedirectUrl(
        "https://cdn-lfs.huggingface.co/model.safetensors",
        "https://huggingface.co/spokedotso/cohere-transcribe-03-2026-mlx-4bit/resolve/revision/model.safetensors",
      );
      expect(redirect).toBe("https://cdn-lfs.huggingface.co/model.safetensors");
    });

    it("exposes model metadata immediately when retrying from broken state", async () => {
      mockState(
        persisted({
          state: "broken",
          family: FAMILY,
          modelId: DEFAULT_MODEL_ID,
          version: VERSION,
          manifestVersion: MANIFEST_VERSION,
          error: "HTTP 403 fetching manifest",
        }),
      );
      initModelManager(makeCallbacks());

      vi.mocked(https.get).mockImplementation(
        () => ({ on: vi.fn().mockReturnThis() }) as any,
      );

      const installPromise = installModel();

      const status = getModelStatus();
      expect(status.state).toBe("downloading");
      expect(status.modelId).toBe(DEFAULT_MODEL_ID);
      expect(status.totalBytes).toBeGreaterThan(0);
      expect(status.error).toBeNull();

      void installPromise.catch(() => {});
    });

    it("keeps model metadata after an install failure", async () => {
      initModelManager(makeCallbacks());

      vi.mocked(https.get).mockImplementation((_url, callback: any) => {
        callback({
          statusCode: 500,
          headers: {},
          resume: vi.fn(),
          on: vi.fn(),
          pipe: vi.fn(),
        });
        return { on: vi.fn().mockReturnThis() } as any;
      });

      await installModel();

      const status = getModelStatus();
      expect(status.state).toBe("broken");
      expect(status.modelId).toBe(DEFAULT_MODEL_ID);
      expect(status.error).toContain("HTTP 500");
    });

    it("throws when an install is already in progress", async () => {
      initModelManager(makeCallbacks());
      vi.mocked(https.get).mockImplementation(
        () => ({ on: vi.fn().mockReturnThis() }) as any,
      );

      const firstInstall = installModel();
      expect(getModelInstallState()).toBe("downloading");

      await expect(installModel()).rejects.toThrow("Install already in progress");
      void firstInstall.catch(() => {});
    });
  });

  describe("removeModel during download", () => {
    it("throws when removing while a download is in progress", async () => {
      initModelManager(makeCallbacks());
      vi.mocked(https.get).mockImplementation(
        () => ({ on: vi.fn().mockReturnThis() }) as any,
      );

      const firstInstall = installModel();
      expect(getModelInstallState()).toBe("downloading");

      await expect(removeModel()).rejects.toThrow(
        "Cannot remove model while install is in progress",
      );
      void firstInstall.catch(() => {});
    });
  });
});
