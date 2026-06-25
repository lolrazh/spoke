/**
 * Sidecar Paths
 *
 * Resolves paths to the MLX STT sidecar binary and model weights, supporting
 * both packaged (production) and development layouts. The sidecar is
 * multi-engine; the active model family is passed at spawn time.
 *
 * - Packaged: binary at `resources/spoke-stt/spoke-stt`, weights in `userData/local-stt/weights/`
 * - Dev: Python venv at `local-stt/.venv/bin/python`, weights in `userData/local-stt/weights/`
 */

import * as path from "path";
import { app } from "electron";
import type { LocalModelFamily } from "../types/shared";

/** Path to the sidecar binary (PyInstaller) or Python interpreter (dev). */
export function getSidecarBinaryPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "spoke-stt", "spoke-stt")
    : path.join(app.getAppPath(), "local-stt", ".venv", "bin", "python");
}

/** Arguments to pass to the sidecar process for a given model family. */
export function getSidecarArgs(family: LocalModelFamily): string[] {
  const modelArgs = ["--family", family, "--weights-dir", getWeightsDir(family)];

  if (app.isPackaged) {
    return modelArgs;
  }

  // Dev uses the same Settings-managed model directory as packaged builds.
  return [path.join(app.getAppPath(), "local-stt", "sidecar.py"), ...modelArgs];
}

/**
 * Directory where a model's weights are stored (user-managed, survives
 * updates). Each model family gets its own subdirectory so multiple models
 * can be installed side by side; calling without a family returns the legacy
 * flat directory (retained for migration of pre-multi-model installs).
 */
export function getWeightsDir(family?: LocalModelFamily): string {
  const base = path.join(app.getPath("userData"), "local-stt", "weights");
  return family ? path.join(base, family) : base;
}

/** Directory for model state and temp files. */
export function getLocalSttDir(): string {
  return path.join(app.getPath("userData"), "local-stt");
}

/** Dev-only: weights directory inside the repo. */
export function getDevWeightsDir(): string {
  return path.join(app.getAppPath(), "local-stt", "weights");
}
