/**
 * Helper Paths
 *
 * Resolves paths to the native Spoke Helper binary, supporting both
 * packaged (production) and development layouts.
 */

import * as path from "path";
import { app } from "electron";

export function getHelperPath(): string {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        "Spoke Helper.app",
        "Contents",
        "MacOS",
        "Spoke Helper",
      )
    : path.join(
        app.getAppPath(),
        "native",
        "bin",
        "Spoke Helper.app",
        "Contents",
        "MacOS",
        "Spoke Helper",
      );
}
