/**
 * Permissions
 *
 * IPC handlers for macOS permission checking and requesting:
 * Accessibility (AX), Input Monitoring (IM), Microphone, and Screen Recording.
 * Uses the native Spoke Helper binary for AX/IM operations and Electron's
 * systemPreferences API for mic/screen.
 */

import * as fs from "fs";
import { app, systemPreferences, shell, ipcMain } from "electron";
import { spawn } from "child_process";
import { getHelperPath } from "./helperPaths";

export interface PermissionHandlerDeps {
  /** Called after IM is granted via ask-im to start the hotkey listener */
  onImGranted: () => Promise<void>;
}

export function registerPermissionHandlers(deps: PermissionHandlerDeps): void {
  ipcMain.handle("check-permissions", async () => {
    try {
      const isDev = !app.isPackaged;
      const needAX = !systemPreferences.isTrustedAccessibilityClient(false);

      const helperPath = getHelperPath();

      if (!fs.existsSync(helperPath)) {
        console.error("Spoke Helper binary not found at path:", helperPath);
        return { needAX, needIM: true, isDev };
      }

      return new Promise((resolve) => {
        const helper = spawn(helperPath, ["--check-permissions"]);

        let output = "";
        helper.stdout.on("data", (data) => {
          output += data.toString();
        });

        helper.on("close", () => {
          const hasAXPermission = output.includes("ax-granted");
          const hasIMPermission = output.includes("im-granted");
          resolve({
            needAX: !hasAXPermission,
            needIM: !hasIMPermission,
            isDev,
          });
        });

        setTimeout(() => {
          helper.kill();
          resolve({ needAX, needIM: true, isDev });
        }, 5000);
      });
    } catch (error) {
      console.error("Error checking permissions:", error);
      return { needAX: true, needIM: true, isDev: !app.isPackaged };
    }
  });

  ipcMain.handle("request-accessibility-permission", async () => {
    try {
      const helperPath = getHelperPath();
      if (!fs.existsSync(helperPath)) {
        console.error("Spoke Helper binary not found at path:", helperPath);
        systemPreferences.isTrustedAccessibilityClient(true);
        return { success: true, via: "fallback-main" } as const;
      }

      return await new Promise<{
        success: boolean;
        status?: string;
        error?: string;
      }>((resolve) => {
        const helper = spawn(helperPath, ["--ask-ax"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        helper.stdout.on("data", (d) => (stdout += d.toString()));
        helper.on("close", () => {
          if (stdout.includes("ax-granted"))
            resolve({ success: true, status: "authorized" });
          else if (stdout.includes("ax-denied"))
            resolve({ success: true, status: "denied" });
          else resolve({ success: false, error: "Unexpected helper output" });
        });
        helper.on("error", (e) =>
          resolve({ success: false, error: (e as Error).message }),
        );
      });
    } catch (error) {
      console.error("Error requesting accessibility permission:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("request-microphone-permission", async () => {
    try {
      console.log("[IPC] Requesting microphone permission...");
      const granted = await systemPreferences.askForMediaAccess("microphone");
      console.log("[IPC] Microphone permission result:", granted);
      return { success: true, granted };
    } catch (error: any) {
      console.error("Error requesting microphone permission:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("check-microphone-permission", () => {
    try {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      console.log("[IPC] Microphone permission status:", status);
      return { status, granted: status === "granted" };
    } catch (error) {
      console.error("Error checking microphone permission:", error);
      return { status: "unknown", granted: false };
    }
  });

  ipcMain.handle("check-screen-recording-permission", () => {
    try {
      const status = systemPreferences.getMediaAccessStatus("screen");
      console.log("[IPC] Screen recording permission status:", status);
      return { status, granted: status === "granted" };
    } catch (error) {
      console.error("Error checking screen recording permission:", error);
      return { status: "unknown", granted: false };
    }
  });

  ipcMain.handle("request-screen-recording-permission", async () => {
    try {
      console.log("[IPC] Requesting screen recording permission...");
      const { desktopCapturer } = await import("electron");
      await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 },
      });

      const status = systemPreferences.getMediaAccessStatus("screen");
      const granted = status === "granted";
      console.log("[IPC] Screen recording permission result:", granted);
      return { success: true, granted };
    } catch (error: any) {
      console.error("Error requesting screen recording permission:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("open-system-preferences", async (_event, pane: string) => {
    try {
      let url = "";

      switch (pane) {
        case "microphone":
          url =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
          break;
        case "screen-recording":
          url =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
          break;
        case "accessibility":
          url =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
          break;
        case "input-monitoring":
          url =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";
          break;
        default:
          url = "x-apple.systempreferences:com.apple.preference.security";
      }

      await shell.openExternal(url);
      console.log(`[IPC] Opened System Preferences: ${pane}`);
    } catch (error) {
      console.error("Error opening System Preferences:", error);
    }
  });

  ipcMain.handle("ask-im", async () => {
    try {
      const isDev = !app.isPackaged;
      console.log(
        `[${isDev ? "Dev" : "Prod"} Mode] Asking for Input Monitoring permission...`,
      );

      const helperPath = getHelperPath();

      if (!fs.existsSync(helperPath)) {
        console.error("Helper binary not found at:", helperPath);
        return { success: false, error: "Helper binary not found", isDev };
      }

      return new Promise((resolve) => {
        const helper = spawn(helperPath, ["--ask-im"], {
          stdio: ["pipe", "pipe", "pipe"],
          detached: false,
        });

        let stdout = "";

        helper.stdout.on("data", (data) => {
          stdout += data.toString();
          console.log("[Ask-IM Output]:", data.toString());
        });

        helper.stderr.on("data", (data) => {
          console.log("[Ask-IM Error]:", data.toString());
        });

        helper.on("close", async (code) => {
          console.log(`[Ask-IM] Process exited with code ${code}`);

          if (stdout.includes("im-granted")) {
            console.log("[Ask-IM] Input Monitoring permission granted");
            try {
              await deps.onImGranted();
            } catch {}
            resolve({ success: true, status: "authorized", isDev });
          } else if (stdout.includes("im-denied")) {
            console.log("[Ask-IM] Input Monitoring permission denied");
            resolve({ success: true, status: "denied", isDev });
          } else {
            console.error("[Ask-IM] Unexpected output from helper");
            resolve({
              success: false,
              error: "Unexpected helper output",
              isDev,
            });
          }
        });

        helper.on("error", (error) => {
          console.error("[Ask-IM] Error running helper:", error);
          resolve({ success: false, error: error.message, isDev });
        });
      });
    } catch (error: any) {
      console.error("Error asking for Input Monitoring permission:", error);
      return { success: false, error: error.message, isDev: !app.isPackaged };
    }
  });
}
