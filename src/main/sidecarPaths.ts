/**
 * Sidecar Paths
 *
 * Resolves paths to the MLX Whisper sidecar binary and model weights, supporting
 * both packaged (production) and development layouts.
 *
 * - Packaged: binary at `resources/spoke-stt/spoke-stt`, weights in `userData/local-stt/weights/`
 * - Dev: Python venv at `local-stt/.venv/bin/python`, weights in `userData/local-stt/weights/`
 */

import * as path from "path";
import { app } from "electron";

/** Path to the sidecar binary (PyInstaller) or Python interpreter (dev). */
export function getSidecarBinaryPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "spoke-stt", "spoke-stt")
    : path.join(app.getAppPath(), "local-stt", ".venv", "bin", "python");
}

/** Arguments to pass to the sidecar process. */
export function getSidecarArgs(): string[] {
  if (app.isPackaged) {
    // Packaged: binary + weights dir in userData
    return ["--weights-dir", getWeightsDir()];
  }

  // Dev uses the same Settings-managed model directory as packaged builds.
  return [
    path.join(app.getAppPath(), "local-stt", "sidecar.py"),
    "--weights-dir",
    getWeightsDir(),
  ];
}

/** Directory where model weights are stored (user-managed, survives updates). */
export function getWeightsDir(): string {
  return path.join(app.getPath("userData"), "local-stt", "weights");
}

/** Directory for model state and temp files. */
export function getLocalSttDir(): string {
  return path.join(app.getPath("userData"), "local-stt");
}

/** Dev-only: weights directory inside the repo. */
export function getDevWeightsDir(): string {
  return path.join(app.getAppPath(), "local-stt", "weights");
}
