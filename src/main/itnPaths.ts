/** Paths to the bundled NeMo inverse-text-normalization resources. */

import path from "node:path";
import { app } from "electron";

export function getItnBinaryPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "spoke-itn")
    : path.join(app.getAppPath(), "native", "bin", "spoke-itn");
}

export function getItnGrammarPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "itn-grammars", "en-US")
    : path.join(app.getAppPath(), "native", "bin", "itn-grammars", "en-US");
}
