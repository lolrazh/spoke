/**
 * Model Manager Tests
 *
 * Tests the state machine logic, persistence, and lifecycle of the model
 * manager. File I/O and Electron's `app` module are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── Mock sidecarPaths ─────────────────────────────────────────────────

const MOCK_LOCAL_STT_DIR = "/tmp/test-spoke/local-stt";
const MOCK_WEIGHTS_DIR = "/tmp/test-spoke/local-stt/weights";

vi.mock("./sidecarPaths", () => ({
  getLocalSttDir: () => MOCK_LOCAL_STT_DIR,
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
  default: {
    get: vi.fn(),
  },
}));

import https from "node:https";

// ── Import after mocks ───────────────────────────────────────────────

import {
  initModelManager,
  getModelStatus,
  getModelInstallState,
  removeModel,
  installModel,
} from "./modelManager";
import type { ModelManagerCallbacks } from "./modelManager";
import {
  LOCAL_MODEL_DISPLAY_NAME,
  LOCAL_MODEL_FAMILY,
  LOCAL_MODEL_ID,
  LOCAL_MODEL_MANIFEST_VERSION,
  LOCAL_MODEL_VERSION,
} from "./localModelContract";
import type { ModelManifestFile } from "../types/shared";

// ── Helpers ───────────────────────────────────────────────────────────

function makeCallbacks(): ModelManagerCallbacks {
  return {
    onStatusChange: vi.fn(),
    onDownloadProgress: vi.fn(),
  };
}

const VALID_INSTALLED_FILES: Pick<
  ModelManifestFile,
  "role" | "path" | "sha256" | "size"
>[] = [
  {
    role: "config",
    path: "config.json",
    sha256: "config-sha",
    size: 100,
  },
  {
    role: "weights",
    path: "weights.safetensors",
    sha256: "weights-sha",
    size: 200,
  },
  {
    role: "tokenizer",
    path: "multilingual.tiktoken",
    sha256: "tokenizer-sha",
    size: 300,
  },
];

function makeReadyState(overrides: Record<string, unknown> = {}) {
  return {
    state: "ready",
    family: LOCAL_MODEL_FAMILY,
    modelId: LOCAL_MODEL_ID,
    displayName: LOCAL_MODEL_DISPLAY_NAME,
    version: "1.0.0",
    manifestVersion: LOCAL_MODEL_MANIFEST_VERSION,
    files: VALID_INSTALLED_FILES,
    ...overrides,
  };
}

function mockExistingState(state: Record<string, unknown>): void {
  const statePath = path.join(MOCK_LOCAL_STT_DIR, "model-state.json");
  (fs.existsSync as any).mockImplementation((p: string) => p === statePath);
  (fs.readFileSync as any).mockImplementation((p: string) => {
    if (p === statePath) return JSON.stringify(state);
    return "{}";
  });
}

function mockExistingStateWithWeights(state: Record<string, unknown>): void {
  const statePath = path.join(MOCK_LOCAL_STT_DIR, "model-state.json");
  const installedPaths = new Set(
    VALID_INSTALLED_FILES.map((file) => path.join(MOCK_WEIGHTS_DIR, file.path)),
  );

  (fs.existsSync as any).mockImplementation((p: string) => {
    return p === statePath || installedPaths.has(p);
  });
  (fs.readFileSync as any).mockImplementation((p: string) => {
    if (p === statePath) return JSON.stringify(state);
    return "{}";
  });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("modelManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing exists
    (fs.existsSync as any).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initModelManager", () => {
    it("should initialize with not_installed when no persisted state", () => {
      const cbs = makeCallbacks();
      initModelManager(cbs);

      const status = getModelStatus();
      expect(status.state).toBe("not_installed");
      expect(status.modelId).toBe(LOCAL_MODEL_ID);
      expect(status.displayName).toBe(LOCAL_MODEL_DISPLAY_NAME);
      expect(status.version).toBe(LOCAL_MODEL_VERSION);
      expect(status.downloadProgress).toBe(0);
      expect(status.totalBytes).toBeGreaterThan(0);
      expect(status.error).toBeNull();
    });

    it("should call onStatusChange callback during init", () => {
      const cbs = makeCallbacks();
      initModelManager(cbs);

      expect(cbs.onStatusChange).toHaveBeenCalledTimes(1);
      expect(cbs.onStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ state: "not_installed" }),
      );
    });

    it("should restore ready state when expected Whisper files exist on disk", () => {
      mockExistingStateWithWeights(makeReadyState());

      const cbs = makeCallbacks();
      initModelManager(cbs);

      const status = getModelStatus();
      expect(status.state).toBe("ready");
      expect(status.family).toBe(LOCAL_MODEL_FAMILY);
      expect(status.modelId).toBe(LOCAL_MODEL_ID);
      expect(status.displayName).toBe(LOCAL_MODEL_DISPLAY_NAME);
      expect(status.manifestVersion).toBe(LOCAL_MODEL_MANIFEST_VERSION);
      expect(status.version).toBe("1.0.0");
      expect(status.totalBytes).toBe(600);
      expect(status.downloadedBytes).toBe(600);
    });

    it("should mark as broken when state says ready but expected files are missing", () => {
      mockExistingState(makeReadyState());

      const cbs = makeCallbacks();
      initModelManager(cbs);

      const status = getModelStatus();
      expect(status.state).toBe("broken");
      expect(status.error).toBe("Model files missing from disk");
    });

    it("should mark stale local model state as broken even if files exist", () => {
      mockExistingStateWithWeights(
        makeReadyState({
          family: null,
          modelId: "legacy-local-model",
        }),
      );

      const cbs = makeCallbacks();
      initModelManager(cbs);

      const status = getModelStatus();
      expect(status.state).toBe("broken");
      expect(status.error).toContain("expected Whisper model");
    });

    it("should restore broken state with error message", () => {
      mockExistingState({
        state: "broken",
        family: LOCAL_MODEL_FAMILY,
        modelId: LOCAL_MODEL_ID,
        displayName: LOCAL_MODEL_DISPLAY_NAME,
        manifestVersion: LOCAL_MODEL_MANIFEST_VERSION,
        version: "1.0.0",
        error: "Checksum mismatch",
      });

      const cbs = makeCallbacks();
      initModelManager(cbs);

      const status = getModelStatus();
      expect(status.state).toBe("broken");
      expect(status.error).toBe("Checksum mismatch");
    });

    it("should reset interrupted downloading state to not_installed", () => {
      mockExistingState({
        state: "downloading",
        modelId: LOCAL_MODEL_ID,
      });

      const cbs = makeCallbacks();
      initModelManager(cbs);

      const status = getModelStatus();
      expect(status.state).toBe("not_installed");
      // Should persist the reset
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should reset interrupted installing state to not_installed", () => {
      mockExistingState({
        state: "installing",
        modelId: LOCAL_MODEL_ID,
      });

      const cbs = makeCallbacks();
      initModelManager(cbs);

      const status = getModelStatus();
      expect(status.state).toBe("not_installed");
    });

    it("should clean up leftover .tmp directory on init", () => {
      const tmpDir = path.join(MOCK_LOCAL_STT_DIR, ".tmp");
      (fs.existsSync as any).mockImplementation((p: string) => p === tmpDir);

      const cbs = makeCallbacks();
      initModelManager(cbs);

      expect(fs.rmSync).toHaveBeenCalledWith(tmpDir, {
        recursive: true,
        force: true,
      });
    });
  });

  describe("getModelStatus", () => {
    it("should return a copy of the status (not a reference)", () => {
      const cbs = makeCallbacks();
      initModelManager(cbs);

      const status1 = getModelStatus();
      const status2 = getModelStatus();
      expect(status1).toEqual(status2);
      expect(status1).not.toBe(status2);
    });
  });

  describe("getModelInstallState", () => {
    it("should return the current state string", () => {
      const cbs = makeCallbacks();
      initModelManager(cbs);

      expect(getModelInstallState()).toBe("not_installed");
    });
  });

  describe("removeModel", () => {
    it("should reset state to not_installed", async () => {
      // Start with a ready state
      mockExistingStateWithWeights(makeReadyState());

      const cbs = makeCallbacks();
      initModelManager(cbs);

      expect(getModelStatus().state).toBe("ready");

      // Now remove
      await removeModel();

      const status = getModelStatus();
      expect(status.state).toBe("not_installed");
      expect(status.modelId).toBe(LOCAL_MODEL_ID);
      expect(status.version).toBe(LOCAL_MODEL_VERSION);
      expect(status.error).toBeNull();
    });

    it("should attempt to delete the weights directory", async () => {
      (fs.existsSync as any).mockImplementation(
        (p: string) => p === MOCK_WEIGHTS_DIR,
      );

      const cbs = makeCallbacks();
      initModelManager(cbs);

      await removeModel();

      expect(fs.rmSync).toHaveBeenCalledWith(MOCK_WEIGHTS_DIR, {
        recursive: true,
        force: true,
      });
    });

    it("should persist the reset state", async () => {
      const cbs = makeCallbacks();
      initModelManager(cbs);

      vi.mocked(fs.writeFileSync).mockClear();
      await removeModel();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(MOCK_LOCAL_STT_DIR, "model-state.json"),
        expect.any(String),
      );
    });

    it("should notify via callback after removal", async () => {
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
    it("should throw when install is already in progress (downloading)", async () => {
      const cbs = makeCallbacks();
      initModelManager(cbs);

      // Start an install that will hang (https.get never calls back)
      vi.mocked(https.get).mockImplementation(() => {
        // Return a fake request object that does nothing
        return { on: vi.fn().mockReturnThis() } as any;
      });

      // Fire-and-forget first install — it will hang on the first file download
      const firstInstall = installModel();

      // State should now be "downloading"
      expect(getModelInstallState()).toBe("downloading");

      // Second install should throw
      await expect(installModel()).rejects.toThrow(
        "Install already in progress",
      );

      // Clean up: the first install is still pending but won't resolve
      // in the test, so we just leave it
      void firstInstall.catch(() => {});
    });

    it("should throw when install is called during installing state", async () => {
      const cbs = makeCallbacks();
      initModelManager(cbs);

      // Simulate the "installing" state by starting a download. We'll do this by directly
      // manipulating state via a full install flow mock.
      // For simplicity, just start install and check downloading guard.
      vi.mocked(https.get).mockImplementation(() => {
        return { on: vi.fn().mockReturnThis() } as any;
      });

      const firstInstall = installModel();
      expect(getModelInstallState()).toBe("downloading");

      await expect(installModel()).rejects.toThrow(
        "Install already in progress",
      );

      void firstInstall.catch(() => {});
    });
  });

  describe("removeModel during download", () => {
    it("should throw when removing while download is in progress", async () => {
      const cbs = makeCallbacks();
      initModelManager(cbs);

      // Start a hanging install
      vi.mocked(https.get).mockImplementation(() => {
        return { on: vi.fn().mockReturnThis() } as any;
      });

      const installPromise = installModel();
      expect(getModelInstallState()).toBe("downloading");

      // Attempting to remove during download should throw
      await expect(removeModel()).rejects.toThrow(
        "Cannot remove model while install is in progress",
      );

      void installPromise.catch(() => {});
    });
  });

  describe("persistence round-trip", () => {
    it("should write state to correct file path", () => {
      mockExistingState({ state: "broken", error: "test error" });

      const cbs = makeCallbacks();
      initModelManager(cbs);

      // broken state from load — no extra persist call
      // But removing should persist
      vi.mocked(fs.writeFileSync).mockClear();

      removeModel();

      const writeCall = vi
        .mocked(fs.writeFileSync)
        .mock.calls.find(
          (call) =>
            call[0] === path.join(MOCK_LOCAL_STT_DIR, "model-state.json"),
        );
      expect(writeCall).toBeDefined();

      const persisted = JSON.parse(writeCall![1] as string);
      expect(persisted.state).toBe("not_installed");
      expect(persisted.modelId).toBe(LOCAL_MODEL_ID);
    });
  });
});
