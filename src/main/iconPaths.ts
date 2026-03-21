/**
 * Icon Paths
 *
 * Resolves application and tray icon paths across multiple possible
 * locations (Vite build, extraResource, source tree).
 */

import * as fs from "fs";
import * as path from "path";

export function getIconPath(): string {
  const possiblePaths = [
    path.join(__dirname, "assets", "icon.png"),
    path.join(__dirname, "..", "assets", "icon.png"),
    path.join(process.resourcesPath, "icon.png"),
    path.join(__dirname, "..", "..", "public", "assets", "icon.png"),
  ];

  for (const iconPath of possiblePaths) {
    try {
      if (fs.existsSync(iconPath)) {
        console.log(`[Main Process] Found icon at: ${iconPath}`);
        return iconPath;
      }
    } catch {
      // Continue to next path
    }
  }

  console.warn("[Main Process] No icon found in any expected location");
  return possiblePaths[0];
}

export function getTrayIconPath(): string {
  const possiblePaths = [
    path.join(__dirname, "assets", "TrayTemplate.png"),
    path.join(__dirname, "..", "assets", "TrayTemplate.png"),
    path.join(process.resourcesPath, "TrayTemplate.png"),
    path.join(__dirname, "..", "..", "public", "assets", "TrayTemplate.png"),
  ];

  for (const trayPath of possiblePaths) {
    try {
      if (fs.existsSync(trayPath)) {
        console.log(`[Main Process] Found tray icon at: ${trayPath}`);

        const trayDir = path.dirname(trayPath);
        const tray2xPath = path.join(trayDir, "TrayTemplate@2x.png");
        if (fs.existsSync(tray2xPath)) {
          console.log(
            `[Main Process] Found high-DPI tray icon at: ${tray2xPath}`,
          );
        }

        return trayPath;
      }
    } catch {
      // Continue to next path
    }
  }

  console.warn("[Main Process] No tray icon found in any expected location");
  return possiblePaths[0];
}
