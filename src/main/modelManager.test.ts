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
  // Mirror production: family-scoped weights live in `weights/<family>/`, and
  // calling without a family returns the legacy flat `weights/` dir (used by
  // the pre-multi-model migration path).
  getWeightsDir: (family?: string) =>
    family ? `${MOCK_WEIGHTS_DIR}/${family}` : MOCK_WEIGHTS_DIR,
}));

/** Family-scoped weights dir, matching the mocked getWeightsDir above. */
function weightsDirFor(modelId: string): string {
  return `${MOCK_WEIGHTS_DIR}/${getModelEntry(modelId)!.manifest.family}`;
}

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
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isFile: () => true })),
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
  cancelInstall,
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
const LEGACY_NEMOTRON_ID =
  "mlx-community/nemotron-3.5-asr-streaming-0.6b-8bit";
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
const OTHER_ENTRY = getModelEntry(OTHER_MODEL_ID)!;
const OTHER_INSTALLED_FILES = OTHER_ENTRY.manifest.files.map((f) => ({
  role: f.role,
  path: f.path,
  sha256: f.sha256,
  size: f.size,
}));

// ── Helpers ───────────────────────────────────────────────────────────

function makeCallbacks(): ModelManagerCallbacks {
  return {
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

/** A ready entry for an arbitrary model id. */
function readyEntryFor(modelId: string): Record<string, unknown> {
  const entry = getModelEntry(modelId)!;
  return {
    state: "ready",
    family: entry.manifest.family,
    modelId,
    displayName: entry.manifest.displayName,
    version: entry.manifest.version,
    manifestVersion: entry.manifest.manifestVersion,
    files:
      modelId === DEFAULT_MODEL_ID ? INSTALLED_FILES : OTHER_INSTALLED_FILES,
    error: null,
  };
}

/** New multi-model persisted shape. */
function persisted(entry: Record<string, unknown>, modelId = DEFAULT_MODEL_ID) {
  return { activeModelId: DEFAULT_MODEL_ID, models: { [modelId]: entry } };
}

/**
 * Persist both models as ready with all their weights present on disk. The
 * mocked `getWeightsDir` is family-agnostic, so every model's files resolve to
 * the same dir; we mark each model's file paths as existing.
 */
function mockBothModelsReady(activeModelId = DEFAULT_MODEL_ID): void {
  const statePath = path.join(MOCK_LOCAL_STT_DIR, "model-state.json");
  const installedPaths = new Set([
    ...INSTALLED_FILES.map((f) =>
      path.join(weightsDirFor(DEFAULT_MODEL_ID), f.path),
    ),
    ...OTHER_INSTALLED_FILES.map((f) =>
      path.join(weightsDirFor(OTHER_MODEL_ID), f.path),
    ),
  ]);
  const state = {
    activeModelId,
    models: {
      [DEFAULT_MODEL_ID]: readyEntryFor(DEFAULT_MODEL_ID),
      [OTHER_MODEL_ID]: readyEntryFor(OTHER_MODEL_ID),
    },
  };
  (fs.existsSync as any).mockImplementation(
    (p: string) => p === statePath || installedPaths.has(p),
  );
  (fs.readFileSync as any).mockImplementation((p: string) =>
    p === statePath ? JSON.stringify(state) : "{}",
  );
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
    INSTALLED_FILES.map((f) =>
      path.join(weightsDirFor(DEFAULT_MODEL_ID), f.path),
    ),
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

    it("migrates the previous Nemotron ID without downloading weights again", () => {
      mockStateWithWeights({
        activeModelId: LEGACY_NEMOTRON_ID,
        models: {
          [LEGACY_NEMOTRON_ID]: readyEntry({
            modelId: LEGACY_NEMOTRON_ID,
          }),
        },
      });

      initModelManager(makeCallbacks());

      expect(getActiveModelId()).toBe(DEFAULT_MODEL_ID);
      expect(getModelStatus().state).toBe("ready");
      expect(getModelStatus().modelId).toBe(DEFAULT_MODEL_ID);
      const persistedJson = (
        fs.writeFileSync as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1)?.[1] as string;
      const persistedState = JSON.parse(persistedJson);
      expect(persistedState.activeModelId).toBe(DEFAULT_MODEL_ID);
      expect(persistedState.models[DEFAULT_MODEL_ID]).toMatchObject({
        state: "ready",
        modelId: DEFAULT_MODEL_ID,
      });
      expect(persistedState.models[LEGACY_NEMOTRON_ID]).toBeUndefined();
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
      const weightsDir = weightsDirFor(DEFAULT_MODEL_ID);
      (fs.existsSync as any).mockImplementation((p: string) => p === weightsDir);
      initModelManager(makeCallbacks());

      await removeModel();

      expect(fs.rmSync).toHaveBeenCalledWith(weightsDir, {
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

    it("promotes another ready model when the active one is removed", async () => {
      mockBothModelsReady(DEFAULT_MODEL_ID);
      initModelManager(makeCallbacks());
      setActiveModelId(DEFAULT_MODEL_ID);
      expect(getActiveModelId()).toBe(DEFAULT_MODEL_ID);

      await removeModel(DEFAULT_MODEL_ID);

      // The other still-ready model is promoted.
      expect(getActiveModelId()).toBe(OTHER_MODEL_ID);
      expect(getModelStatus(DEFAULT_MODEL_ID).state).toBe("not_installed");
      expect(getModelStatus(OTHER_MODEL_ID).state).toBe("ready");
    });

    it("falls back to the default model when no other model is ready", async () => {
      mockBothModelsReady(DEFAULT_MODEL_ID);
      initModelManager(makeCallbacks());

      // Remove the default (active) -> promotes the remaining ready OTHER model.
      await removeModel(DEFAULT_MODEL_ID);
      expect(getActiveModelId()).toBe(OTHER_MODEL_ID);

      // Remove the now-active OTHER model -> nothing ready left, fall back.
      await removeModel(OTHER_MODEL_ID);
      expect(getActiveModelId()).toBe(DEFAULT_MODEL_ID);
      expect(getModelStatus(OTHER_MODEL_ID).state).toBe("not_installed");
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

      // https.get is now called as get(url, { signal }, cb): the response
      // callback is the last argument.
      vi.mocked(https.get).mockImplementation((...args: any[]) => {
        const callback = args[args.length - 1];
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

    it("throws when removing/reinstalling while in the installing state", async () => {
      initModelManager(makeCallbacks());

      // Successful downloads for every file so the install advances past the
      // download phase into "installing" (sha256 verification).
      vi.mocked(https.get).mockImplementation((...args: any[]) => {
        const callback = args[args.length - 1];
        const res = {
          statusCode: 200,
          headers: { "content-length": "10" },
          resume: vi.fn(),
          on: vi.fn((event: string, cb: (chunk?: Buffer) => void) => {
            if (event === "data") cb(Buffer.alloc(10));
            return res;
          }),
          pipe: vi.fn(),
        };
        callback(res);
        return { on: vi.fn().mockReturnThis() } as any;
      });
      // Write stream resolves immediately so each download "finish"es.
      (fs.createWriteStream as any).mockImplementation(() => {
        const handlers: Record<string, () => void> = {};
        return {
          on: (event: string, cb: () => void) => {
            handlers[event] = cb;
            if (event === "finish") setTimeout(cb, 0);
          },
          close: vi.fn(),
        };
      });
      // A read stream that never emits "end" so verifySha256 (and thus the
      // overall install) stays pending in the "installing" state.
      (fs.createReadStream as any).mockImplementation(() => ({
        on: vi.fn().mockReturnThis(),
      }));

      const installPromise = installModel();
      // Poll until the (mocked) downloads finish and the install enters the
      // verification phase; avoids depending on a fixed wall-clock delay.
      for (let i = 0; i < 200 && getModelInstallState() !== "installing"; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(getModelInstallState()).toBe("installing");

      await expect(installModel()).rejects.toThrow("Install already in progress");
      await expect(removeModel()).rejects.toThrow(
        "Cannot remove model while install is in progress",
      );

      void installPromise.catch(() => {});
    });
  });

  describe("cancelInstall", () => {
    it("aborts an in-flight download and resets the model to not_installed", async () => {
      initModelManager(makeCallbacks());

      // A download that hangs until its request is aborted. We mirror Node's
      // https.get(url, { signal }, cb): when the signal fires, the request
      // emits an AbortError on its "error" handler, which downloadFile rejects.
      vi.mocked(https.get).mockImplementation((...args: any[]) => {
        const options = args[1] as { signal?: AbortSignal };
        const req: any = {
          on: vi.fn((event: string, cb: (err: Error) => void) => {
            if (event === "error" && options?.signal) {
              options.signal.addEventListener("abort", () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                cb(err);
              });
            }
            return req;
          }),
        };
        return req;
      });

      const installPromise = installModel();
      expect(getModelInstallState()).toBe("downloading");

      cancelInstall();
      await installPromise;

      const status = getModelStatus();
      expect(status.state).toBe("not_installed");
      expect(status.error).toBeNull();
      expect(status.downloadProgress).toBe(0);
    });

    it("is a no-op when nothing is downloading", () => {
      initModelManager(makeCallbacks());
      expect(() => cancelInstall()).not.toThrow();
      expect(getModelInstallState()).toBe("not_installed");
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

  describe("persistence", () => {
    it("writes the new multi-model shape with per-model entries", () => {
      mockBothModelsReady(DEFAULT_MODEL_ID);
      initModelManager(makeCallbacks());

      const statePath = path.join(MOCK_LOCAL_STT_DIR, "model-state.json");
      const writeCall = vi
        .mocked(fs.writeFileSync)
        .mock.calls.find((c) => c[0] === statePath);
      expect(writeCall).toBeDefined();

      const parsed = JSON.parse(writeCall![1] as string);

      // Top-level shape: { activeModelId, models: { <id>: {...} } }.
      expect(parsed.activeModelId).toBe(DEFAULT_MODEL_ID);
      expect(typeof parsed.models).toBe("object");
      expect(Object.keys(parsed.models).sort()).toEqual(
        [...LOCAL_MODEL_IDS].sort(),
      );

      // Each known model has a fully-formed per-model entry: ready for the
      // two mocked-installed models, not_installed placeholders for the rest.
      const readyIds = new Set([DEFAULT_MODEL_ID, OTHER_MODEL_ID]);
      for (const modelId of LOCAL_MODEL_IDS) {
        const entry = parsed.models[modelId];
        expect(entry).toBeDefined();
        expect(entry.modelId).toBe(modelId);
        expect(entry.family).toBe(getModelEntry(modelId)!.manifest.family);
        if (readyIds.has(modelId)) {
          expect(entry.state).toBe("ready");
          expect(Array.isArray(entry.files)).toBe(true);
          expect(entry.files.length).toBeGreaterThan(0);
        } else {
          expect(entry.state).toBe("not_installed");
        }
      }
    });
  });

  describe("migrateLegacyWhisperWeights", () => {
    const LEGACY_DIR = MOCK_WEIGHTS_DIR; // getWeightsDir() with no family
    const WHISPER_DIR = `${MOCK_WEIGHTS_DIR}/whisper`;
    const MARKER = path.join(LEGACY_DIR, "weights.safetensors");

    it("moves legacy flat weights into weights/whisper", () => {
      // Legacy marker present, target dir absent -> migrate.
      (fs.existsSync as any).mockImplementation(
        (p: string) => p === MARKER || p === LEGACY_DIR,
      );
      (fs.readdirSync as any).mockReturnValue([
        "weights.safetensors",
        "config.json",
      ]);
      (fs.statSync as any).mockReturnValue({ isFile: () => true });

      initModelManager(makeCallbacks());

      expect(fs.mkdirSync).toHaveBeenCalledWith(WHISPER_DIR, {
        recursive: true,
      });
      expect(fs.renameSync).toHaveBeenCalledWith(
        path.join(LEGACY_DIR, "weights.safetensors"),
        path.join(WHISPER_DIR, "weights.safetensors"),
      );
      expect(fs.renameSync).toHaveBeenCalledWith(
        path.join(LEGACY_DIR, "config.json"),
        path.join(WHISPER_DIR, "config.json"),
      );
    });

    it("no-ops when the target weights/whisper dir already exists", () => {
      (fs.existsSync as any).mockImplementation(
        (p: string) => p === MARKER || p === WHISPER_DIR,
      );
      (fs.readdirSync as any).mockReturnValue(["weights.safetensors"]);
      (fs.statSync as any).mockReturnValue({ isFile: () => true });

      initModelManager(makeCallbacks());

      // No migration moves should occur.
      const movedToWhisper = vi
        .mocked(fs.renameSync)
        .mock.calls.some((c) => String(c[1]).startsWith(WHISPER_DIR));
      expect(movedToWhisper).toBe(false);
    });

    it("no-ops when the legacy marker file is absent", () => {
      // Nothing exists -> no marker -> no migration.
      (fs.existsSync as any).mockReturnValue(false);
      (fs.readdirSync as any).mockReturnValue(["weights.safetensors"]);
      (fs.statSync as any).mockReturnValue({ isFile: () => true });

      initModelManager(makeCallbacks());

      const movedToWhisper = vi
        .mocked(fs.renameSync)
        .mock.calls.some((c) => String(c[1]).startsWith(WHISPER_DIR));
      expect(movedToWhisper).toBe(false);
    });
  });
});
