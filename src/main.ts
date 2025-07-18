import {
  app,
  BrowserWindow,
  Tray,
  nativeImage,
  screen,
  ipcMain,
  clipboard,
  session,
  Menu,
  shell,
  dialog,
} from "electron";
import path from "node:path";
import process from "node:process";
import { spawn, execFile } from "child_process";

import fs from "node:fs";

import {
  ISLAND_HIDDEN_Y,
  ISLAND_WIDTH,
  ISLAND_HEIGHT,
  ISLAND_VISIBLE_Y,
} from "./constants/window";

// Microphone device management types
type MicDevice = { id: string; label: string };
type MicPreferences = { selectedMicId?: string };

// Add command line switches for WebGPU (currently disabled)
// app.commandLine.appendSwitch('enable-unsafe-webgpu');
// app.commandLine.appendSwitch('ignore-gpu-blocklist');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let homeWindow: BrowserWindow | null = null;
let fnProc: import("child_process").ChildProcessWithoutNullStreams | null =
  null;
let fnRestartTimeout: NodeJS.Timeout | null = null;
let fnPermissionDenied = false;
let fnStdoutBuffer = ""; // Buffer for incomplete lines from fn-tap stdout
let fnPermissionDialogShown = false;

// Microphone management state
let micDevices: MicDevice[] = [
  { id: "default", label: "System Default" } // Always available fallback
];
let micPreferences: MicPreferences = {};
const micPrefsPath = path.join(app.getPath("userData"), "mic-preferences.json");

// Last transcript storage for context menu copy functionality
let lastTranscript: string = "";

function logBounds(tag: string) {
  if (!mainWindow) return;
  const b = mainWindow.getBounds();
  const [cw, ch] = mainWindow.getContentSize();
  console.log(`[${tag}] bounds=%o content=%o`, b, { w: cw, h: ch });
}

// Microphone preference management functions
function loadMicPreferences(): MicPreferences {
  try {
    if (fs.existsSync(micPrefsPath)) {
      const data = fs.readFileSync(micPrefsPath, "utf8");
      const prefs = JSON.parse(data);
      console.log("[MicPrefs] Loaded preferences:", prefs);
      return prefs;
    }
  } catch (error) {
    console.error("[MicPrefs] Failed to load preferences:", error);
  }
  
  const defaultPrefs = { selectedMicId: "default" };
  console.log("[MicPrefs] Using default preferences:", defaultPrefs);
  return defaultPrefs;
}

function saveMicPreferences(prefs: MicPreferences): void {
  try {
    // Ensure userData directory exists
    const userDataDir = app.getPath("userData");
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    
    fs.writeFileSync(micPrefsPath, JSON.stringify(prefs, null, 2));
    console.log("[MicPrefs] Saved preferences:", prefs);
  } catch (error) {
    console.error("[MicPrefs] Failed to save preferences:", error);
  }
}

function updateMicDevices(devices: MicDevice[]): void {
  console.log("[MicMgmt] Updating device list:", devices);
  
  // Always ensure "System Default" is first, then add other devices
  const defaultDevice = { id: "default", label: "System Default" };
  const otherDevices = devices.filter(d => d.id !== "default");
  micDevices = [defaultDevice, ...otherDevices];
  
  console.log("[MicMgmt] Final device list with default:", micDevices);
  
  // Validate current selection still exists
  if (micPreferences.selectedMicId && 
      !micDevices.find(d => d.id === micPreferences.selectedMicId)) {
    console.log("[MicMgmt] Selected device no longer available, resetting to default");
    micPreferences.selectedMicId = "default";
    saveMicPreferences(micPreferences);
  }
  
  // Rebuild tray menu with new devices
  rebuildTrayMenu();
  
  // Notify renderers of selection change
  broadcastMicSelection();
}

function selectMicDevice(deviceId: string): void {
  console.log("[MicMgmt] Selecting device:", deviceId);
  
  // Validate device exists
  if (deviceId !== "default" && !micDevices.find(d => d.id === deviceId)) {
    console.error("[MicMgmt] Device not found:", deviceId);
    return;
  }
  
  micPreferences.selectedMicId = deviceId;
  saveMicPreferences(micPreferences);
  
  // Rebuild tray menu to update checkmarks
  rebuildTrayMenu();
  
  // Notify renderers
  broadcastMicSelection();
}

function broadcastMicSelection(): void {
  const selectedId = micPreferences.selectedMicId || "default";
  console.log("[MicMgmt] Broadcasting selection:", selectedId);
  
  // Send to all renderer windows
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send("mic:selected-changed", { id: selectedId });
  });
}

// FUCK IT - USE PNG FOR EVERYTHING! It works better at runtime
// Try multiple possible locations for the icon
const getIconPath = () => {
  const possiblePaths = [
    path.join(__dirname, "assets", "icon.png"), // Vite build location
    path.join(__dirname, "..", "assets", "icon.png"), // Alternative location
    path.join(process.resourcesPath, "icon.png"), // extraResource location
    path.join(__dirname, "..", "..", "public", "assets", "icon.png"), // Source location
  ];

  for (const iconPath of possiblePaths) {
    try {
      if (fs.existsSync(iconPath)) {
        console.log(`[Main Process] Found icon at: ${iconPath}`);
        return iconPath;
      }
    } catch (error) {
      // Continue to next path
    }
  }

  console.warn("[Main Process] No icon found in any expected location");
  return possiblePaths[0]; // fallback
};

const getTrayIconPath = () => {
  const possiblePaths = [
    path.join(__dirname, "assets", "TrayTemplate.png"), // Vite build location (base 16x16)
    path.join(__dirname, "..", "assets", "TrayTemplate.png"), // Alternative location
    path.join(process.resourcesPath, "TrayTemplate.png"), // extraResource location
    path.join(__dirname, "..", "..", "public", "assets", "TrayTemplate.png"), // Source location
  ];

  for (const trayPath of possiblePaths) {
    try {
      if (fs.existsSync(trayPath)) {
        console.log(`[Main Process] Found tray icon at: ${trayPath}`);
        
        // Also check if @2x version exists in the same directory for high-DPI
        const trayDir = path.dirname(trayPath);
        const tray2xPath = path.join(trayDir, "TrayTemplate@2x.png");
        if (fs.existsSync(tray2xPath)) {
          console.log(`[Main Process] Found high-DPI tray icon at: ${tray2xPath}`);
        }
        
        return trayPath;
      }
    } catch (error) {
      // Continue to next path
    }
  }

  console.warn("[Main Process] No tray icon found in any expected location");
  return possiblePaths[0]; // fallback
};

const iconPath = getIconPath();

const createWindow = () => {
  // Create the browser window.
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: ISLAND_WIDTH,
    height: ISLAND_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000", // Fully transparent background
    hasShadow: false, // <-- KILL the macOS shadow (= white block)
    resizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    focusable: false, // <-- Keeps the previous app front-most
    acceptFirstMouse: true, // <-- Allows first click to pass through to the webview
    hiddenInMissionControl: true, // <-- Hides from exposé
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      enableWebSQL: false,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: ["--enable-features=SharedArrayBuffer"],
    },
  };

  // Try to set the icon, but don't crash if it fails
  const windowIconPath = iconPath;

  try {
    const icon = nativeImage.createFromPath(windowIconPath);
    if (!icon.isEmpty()) {
      windowOptions.icon = windowIconPath;
    } else {
      console.warn(
        `Icon not found at path: ${windowIconPath}, continuing without icon`,
      );
    }
  } catch (error) {
    console.warn(
      `Failed to load icon: ${error.message}, continuing without icon`,
    );
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Also try to set the icon explicitly after creation (optional but good practice)
  try {
    const icon = nativeImage.createFromPath(windowIconPath);
    if (!icon.isEmpty()) {
      mainWindow.setIcon(windowIconPath);
    }
  } catch (error) {
    console.warn(`Failed to set window icon: ${error.message}`);
  }

  // Set window behaviors for macOS
  if (process.platform === "darwin") {
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.setVisibleOnAllWorkspaces(true);
  }

  // Show window inactive only when it's ready to prevent focus stealing
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    console.log("Main window shown.");

    // Open DevTools automatically in development mode
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
      console.log("DevTools opened in development mode.");
    }
    // Note: DevTools disabled in production to maintain transparency on macOS
  });

  // Option 2 (as per suggestion): Use 'closed' event for logging after the fact
  mainWindow.on("closed", () => {
    console.log("Main window has been closed.");
    mainWindow = null; // Ensure reference is cleared
  });

  // Rebuild tray menu when main window visibility changes to update "Show Floating Bar" option
  mainWindow.on("show", () => {
    console.log("[Main Window] Window shown, rebuilding tray menu");
    rebuildTrayMenu();
  });

  mainWindow.on("hide", () => {
    console.log("[Main Window] Window hidden, rebuilding tray menu");
    rebuildTrayMenu();
  });

  // Position window centered horizontally and hidden under the notch
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: fullScreenWidth } = primaryDisplay.size; // Use full screen width, not workAreaSize
  const initialX = Math.round((fullScreenWidth - ISLAND_WIDTH) / 2);
  console.log(
    `[Window Creation] Screen: ${fullScreenWidth}px, Island: ${ISLAND_WIDTH}px, Initial X: ${initialX}, Y: ${ISLAND_HIDDEN_Y}`,
  );
  mainWindow.setBounds({
    x: initialX,
    y: ISLAND_HIDDEN_Y,
    width: ISLAND_WIDTH,
    height: ISLAND_HEIGHT,
  });
  logBounds("createWindow");

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Hide menu bar
  mainWindow.setMenuBarVisibility(false);

  // Make window click-through by default - clicks pass through to underlying windows
  mainWindow.setIgnoreMouseEvents(true);

  // Add this handler to grant permissions needed for SharedArrayBuffer in some contexts
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      // In a real app, you might want to be more specific about which permissions
      // and origins you grant, but for local development/SAB, granting broadly is common.
      console.log(
        `Granting permission: ${permission} to ${webContents.getURL()}`,
      );
      callback(true);
    },
  );
};

function buildTrayMenu(): Electron.MenuItemConstructorOptions[] {
  console.log("[Tray Menu] Building tray menu with", micDevices.length, "devices");
  const selectedMicId = micPreferences.selectedMicId || "default";
  
  // Build microphone submenu
  const micSubmenu: Electron.MenuItemConstructorOptions[] = [];
  
  if (micDevices.length === 0) {
    micSubmenu.push({
      label: "No microphones detected",
      enabled: false,
    });
  } else {
    // Add each device as a menu item
    micDevices.forEach(device => {
      micSubmenu.push({
        label: device.label,
        type: "radio",
        checked: device.id === selectedMicId,
        click: () => {
          console.log(`[Tray Menu] Microphone selected: ${device.label} (${device.id})`);
          selectMicDevice(device.id);
        },
      });
    });
  }
  
  return [
    {
      label: "Open Sonic Flow Home",
      click: () => {
        console.log("[Tray Menu] Open Sonic Flow Home clicked");
        if (homeWindow) {
          console.log("[Tray Menu] Home window exists, focusing...");
          homeWindow.show();
          homeWindow.focus();
        } else {
          console.log(
            "[Tray Menu] Home window is null, creating new window...",
          );
          createHomeWindow();
        }
      },
    },
    {
      label: "Show Floating Bar",
      visible: mainWindow ? !mainWindow.isVisible() : false,
      click: () => {
        console.log("[Tray Menu] Show Floating Bar clicked");
        if (mainWindow) {
          mainWindow.show();
          console.log("[Tray Menu] Floating bar shown");
        }
      },
    },
    {
      label: "Select Microphone",
      submenu: micSubmenu,
    },
    { type: "separator" },
    {
      label: "Send Feedback…",
      click: () => {
        console.log("[Tray Menu] Send Feedback clicked");
        // Open default email client with pre-filled feedback email
        const feedbackEmail = encodeURI(
          `mailto:rajkumar.sandheep@gmail.com?subject=Sonic%20Flow%20Feedback&body=Hi%20there!%0A%0ADescribe%20your%20feedback%20or%20issue%20here...%0A%0A---%0ASonic%20Flow%20${app.getVersion()}%0AmacOS%20${process.getSystemVersion()}`
        );
        shell.openExternal(feedbackEmail);
      },
    },
    {
      label: "About Sonic Flow",
      click: () => {
        console.log("[Tray Menu] About Sonic Flow clicked");
        // Use native macOS about panel
        app.setAboutPanelOptions({
          applicationName: "Sonic Flow",
          applicationVersion: app.getVersion(),
          credits: "A lightweight AI dictation tool for macOS.",
          authors: ["Sandheep Rajkumar"],
        });
        app.showAboutPanel();
      },
    },
    { type: "separator" },
    {
      label: "Quit Sonic Flow",
      click: () => {
        console.log("[Tray Menu] Quit Sonic Flow clicked");
        isQuitting = true;
        app.quit();
      },
    },
  ];
}

function buildPillContextMenu(): Electron.MenuItemConstructorOptions[] {
  console.log("[Pill Menu] Building pill context menu with", micDevices.length, "devices");
  const selectedMicId = micPreferences.selectedMicId || "default";
  
  // Build microphone submenu
  const micSubmenu: Electron.MenuItemConstructorOptions[] = [];
  
  if (micDevices.length === 0) {
    micSubmenu.push({
      label: "No microphones detected",
      enabled: false,
    });
  } else {
    // Add each device as a menu item
    micDevices.forEach(device => {
      micSubmenu.push({
        label: device.label,
        type: "radio",
        checked: device.id === selectedMicId,
        click: () => {
          console.log(`[Pill Menu] Microphone selected: ${device.label} (${device.id})`);
          selectMicDevice(device.id);
        },
      });
    });
  }
  
  return [
    {
      label: "Open Sonic Flow Home",
      click: () => {
        console.log("[Pill Menu] Open Sonic Flow Home clicked");
        if (homeWindow) {
          console.log("[Pill Menu] Home window exists, focusing...");
          homeWindow.show();
          homeWindow.focus();
        } else {
          console.log(
            "[Pill Menu] Home window is null, creating new window...",
          );
          createHomeWindow();
        }
      },
    },
    {
      label: "Select Microphone",
      submenu: micSubmenu,
    },
    { type: "separator" },
    {
      label: "Copy Last Transcript",
      enabled: lastTranscript.length > 0,
      click: () => {
        console.log("[Pill Menu] Copy Last Transcript clicked");
        if (lastTranscript) {
          clipboard.writeText(lastTranscript);
          mainWindow?.webContents.send("notify", "Transcript copied to clipboard");
        }
      },
    },
    {
      label: "Hide Floating Bar",
      click: () => {
        console.log("[Pill Menu] Hide Floating Bar clicked");
        if (mainWindow) {
          mainWindow.hide();
          mainWindow?.webContents.send("notify", "Floating bar hidden. Use tray menu to show again.");
        }
      },
    },
    { type: "separator" },
    {
      label: "Send Feedback…",
      click: () => {
        console.log("[Pill Menu] Send Feedback clicked");
        // Open default email client with pre-filled feedback email
        const feedbackEmail = encodeURI(
          `mailto:rajkumar.sandheep@gmail.com?subject=Sonic%20Flow%20Feedback&body=Hi%20there!%0A%0ADescribe%20your%20feedback%20or%20issue%20here...%0A%0A---%0ASonic%20Flow%20${app.getVersion()}%0AmacOS%20${process.getSystemVersion()}`
        );
        shell.openExternal(feedbackEmail);
      },
    },
    {
      label: "About Sonic Flow",
      click: () => {
        console.log("[Pill Menu] About Sonic Flow clicked");
        // Use native macOS about panel
        app.setAboutPanelOptions({
          applicationName: "Sonic Flow",
          applicationVersion: app.getVersion(),
          credits: "A lightweight AI dictation tool for macOS.",
          authors: ["Sandheep Rajkumar"],
        });
        app.showAboutPanel();
      },
    },
  ];
}

function rebuildTrayMenu(): void {
  if (!tray || tray.isDestroyed()) {
    console.log("[Tray] Cannot rebuild menu - tray not available");
    return;
  }
  
  console.log("[Tray] Rebuilding menu with updated microphone list");
  const menuTemplate = buildTrayMenu();
  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
  console.log("[Tray] Menu rebuilt successfully");
}

const createTray = () => {
  try {
    console.log("[Tray] Starting tray creation...");
    
    // Check if tray already exists
    if (tray) {
      console.log("[Tray] Tray already exists, skipping creation");
      return;
    }

    // Load the tray template icon (Electron will auto-detect @2x version)
    const trayIconPath = getTrayIconPath();
    console.log(`[Tray] Attempting to load tray template from: ${trayIconPath}`);
    
    let icon = nativeImage.createFromPath(trayIconPath);

    if (icon.isEmpty()) {
      console.error(
        `[Tray] Failed to load tray icon from path: ${trayIconPath}. Using empty icon.`,
      );
      icon = nativeImage.createEmpty(); // Fallback to empty
    } else {
      console.log(`[Tray] Successfully loaded tray icon from path: ${trayIconPath}`);
      const iconSize = icon.getSize();
      console.log(`[Tray] Loaded icon size: ${iconSize.width}x${iconSize.height} (should be 16x16 for base)`);
      
      // Mark as template for proper macOS automatic tinting (light/dark mode)
      icon.setTemplateImage(true);
      console.log("[Tray] Icon marked as template for automatic macOS tinting");
    }

    console.log("[Tray] Creating Tray instance...");
    tray = new Tray(icon);
    console.log("[Tray] Tray instance created successfully");
    
    // Additional debugging for tray visibility
    console.log(`[Tray] Tray destroyed state: ${tray.isDestroyed()}`);
    
    tray.setToolTip("Sonic Flow");
    
    // Force tray to be visible (macOS sometimes hides it)
    if (process.platform === "darwin") {
      tray.setIgnoreDoubleClickEvents(false);
      // Try to force display the tray
      setTimeout(() => {
        if (tray && !tray.isDestroyed()) {
          console.log("[Tray] Forcing tray visibility on macOS");
          tray.setToolTip("Sonic Flow - AI Dictation");
        }
      }, 100);
    }
    
    console.log("[Tray] Tooltip set");

    // Create enhanced native context menu with dynamic microphone list
    console.log("[Tray] Building context menu...");
    const menuTemplate = buildTrayMenu();
    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    
    // Add event listener for when tray menu is about to open
    tray.on('click', () => {
      console.log("[Tray] 🎯 Tray menu opening - requesting device refresh");
      // Send refresh request to renderer processes before showing menu
      BrowserWindow.getAllWindows().forEach(window => {
        console.log("[Tray] Sending mic:refresh-devices to window:", window.id);
        window.webContents.send("mic:refresh-devices");
      });
    });
    
    // Set the native context menu
    console.log("[Tray] Setting context menu...");
    tray.setContextMenu(contextMenu);
    console.log("[Tray] ✅ Tray created successfully with enhanced menu!");
  } catch (error) {
    console.error("[Tray] ❌ Failed to create tray:", error);
    console.error("[Tray] Error stack:", error.stack);
    // Ensure tray is null if creation fails
    if (tray) {
      try {
        tray.destroy();
      } catch (destroyError) {
        console.error("[Tray] Failed to destroy tray:", destroyError);
      }
    }
    tray = null;
  }
};

// Add a handler for insert-text-at-cursor
ipcMain.handle(
  "insert-text-at-cursor",
  async (_event: Electron.IpcMainInvokeEvent, text: string) => {
    if (!text) {
      console.warn("[PasteHelper] Received empty text. Aborting insertion.");
      return { success: false, error: "Cannot insert empty text." };
    }

    try {
      console.log("=== TEXT INSERTION PROCESS START ===");
      console.log("Received text:", text);

      const originalClipboardText = clipboard.readText();
      console.log("Original clipboard text stored.");

      const trimmedText = text.trimStart();
      clipboard.writeText(trimmedText);
      console.log("Transcription text copied to clipboard for pasting.");

      const helperPath = app.isPackaged
        ? path.join(process.resourcesPath, "paste-helper")
        : path.join(app.getAppPath(), "native", "bin", "paste-helper");

      if (!fs.existsSync(helperPath)) {
        console.error(
          `[PasteHelper] paste-helper binary not found at path: ${helperPath}`,
        );
        mainWindow?.webContents.send(
          "notify",
          "Paste unavailable: binary missing. Copied to clipboard.",
        );
        return { success: false, error: "Paste helper binary not found." };
      }

      console.log(`[PasteHelper] Executing from: ${helperPath}`);
      execFile(helperPath, (error, stdout, stderr) => {
        // Log output from the helper process for diagnostics
        if (stdout) {
          console.log(`[PasteHelper stdout]: ${stdout.trim()}`);
        }
        if (stderr) {
          console.error(`[PasteHelper stderr]: ${stderr.trim()}`);
        }

        if (error) {
          console.error("[PasteHelper] Error executing paste-helper:", error);
          // This can happen if Accessibility permission is not granted.
          // The helper will prompt for it on the first run.
          // As a fallback, we leave the transcribed text in the clipboard.
          mainWindow?.webContents.send(
            "notify",
            "Paste failed. Grant Accessibility permission. Text copied.",
          );
        } else {
          console.log("[PasteHelper] paste-helper executed successfully.");
          // If successful, restore the original clipboard content after a short delay.
          setTimeout(() => {
            console.log("[PasteHelper] Restoring original clipboard content.");
            clipboard.writeText(originalClipboardText);
          }, 300);
        }
      });

      console.log("=== TEXT INSERTION PROCESS COMPLETE ===");
      return { success: true };
    } catch (error) {
      console.error("=== TEXT INSERTION PROCESS FAILED (Exception) ===");
      console.error("Error during text insertion:", error);
      // In case of any other error, leave the transcribed text in the clipboard.
      clipboard.writeText(text);
      mainWindow?.webContents.send(
        "notify",
        "Error. Text copied to clipboard.",
      );
      return {
        success: false,
        error:
          "An error occurred during text insertion. Text copied to clipboard.",
      };
    }
  },
);

app.whenReady().then(() => {
  const isDev = !app.isPackaged;
  console.log(
    "[Main Process] Setting up onHeadersReceived listener for COOP/COEP...",
  );
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      "connect-src 'self' https://api.sonicflow.app https://huggingface.co https://cdn.jsdelivr.net blob:",
      `script-src 'self' 'unsafe-eval' ${isDev ? "'unsafe-inline'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
    ].join("; ");

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Content-Security-Policy": csp,
      },
    });
  });
  console.log("[Main Process] onHeadersReceived listener configured.");

  app.commandLine.appendSwitch("disable-http-cache");

  // macOS dock icon setup
  try {
    // Try to set the dock icon explicitly (fallback if app bundle icon fails)
    const dockIcon = nativeImage.createFromPath(iconPath);
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
      console.log("[Main Process] Dock icon set successfully");
    }
  } catch (error) {
    console.warn("[Main Process] Failed to set dock icon:", error.message);
  }

  createWindow();
  
  // Initialize microphone preferences
  console.log("[Main Process] Initializing microphone preferences...");
  micPreferences = loadMicPreferences();
  console.log("[Main Process] Microphone preferences loaded:", micPreferences);
  
  createTray();
  createHomeWindow();
  startFnListener();

  // Handle pill context menu
  ipcMain.on("show-pill-context-menu", () => {
    console.log("[IPC Main] Received show-pill-context-menu event");
    if (mainWindow) {
      // Send refresh request to renderer processes before showing menu to ensure device list is current
      BrowserWindow.getAllWindows().forEach(window => {
        console.log("[Pill Menu] Sending mic:refresh-devices to window:", window.id);
        window.webContents.send("mic:refresh-devices");
      });

      const menuTemplate = buildPillContextMenu();
      const contextMenu = Menu.buildFromTemplate(menuTemplate);
      contextMenu.popup({ window: mainWindow });
    }
  });

  ipcMain.on(
    "show-notification",
    (event: Electron.IpcMainEvent, message: string) => {
      console.log(
        `[IPC Main] Received show-notification request, forwarding to renderer: ${message}`,
      );
      mainWindow?.webContents.send("notify", message);
    },
  );

  ipcMain.on("pill-resize", (event, { width, height }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth } = primaryDisplay.size;
      const x = Math.round((screenWidth - width) / 2);

      const currentBounds = mainWindow.getBounds();
      mainWindow.setBounds(
        {
          x: x,
          y: currentBounds.y,
          width: Math.round(width),
          height: Math.round(height),
        },
        false,
      ); // animate: false

      if (process.platform === "darwin") {
        mainWindow.invalidateShadow();
      }
      logBounds("pill-resize");
    }
  });

  // Handle dynamic click-through control
  ipcMain.on("set-click-through", (event, clickThrough: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
    }
  });

  ipcMain.on("pill-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const currentBounds = mainWindow.getBounds();
      mainWindow.setBounds(
        {
          y: ISLAND_VISIBLE_Y,
          height: currentBounds.height,
          width: currentBounds.width,
          x: currentBounds.x,
        },
        false,
      );
      logBounds("pill-show");
      mainWindow.focus();
    }
  });

  ipcMain.on("pill-hide", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const currentBounds = mainWindow.getBounds();
      mainWindow.setBounds(
        {
          y: ISLAND_HIDDEN_Y,
          height: currentBounds.height,
          width: currentBounds.width,
          x: currentBounds.x,
        },
        false,
      );
      logBounds("pill-hide");
    }
  });

  ipcMain.on("island-slide", (_e, y) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: fullScreenWidth } = primaryDisplay.size;
      // Recalculate X to ensure perfect centering on every slide
      const centeredX = Math.round((fullScreenWidth - ISLAND_WIDTH) / 2);
      console.log(
        `[Island Slide] Screen: ${fullScreenWidth}px, Island: ${ISLAND_WIDTH}px, Centered X: ${centeredX}, Y: ${y}`,
      );
      mainWindow.setBounds({
        x: centeredX,
        y: y,
        width: ISLAND_WIDTH,
        height: ISLAND_HEIGHT,
      });
    }
  });

  // Microphone management IPC handlers
  ipcMain.on("mic:devices-update", (_event, payload: { devices: MicDevice[], selectedId?: string }) => {
    console.log("[IPC] Received microphone devices update:", payload);
    updateMicDevices(payload.devices);
  });

  ipcMain.handle("mic:select", (_event, payload: { id: string }) => {
    console.log("[IPC] Received microphone selection:", payload.id);
    try {
      selectMicDevice(payload.id);
      return { ok: true };
    } catch (error) {
      console.error("[IPC] Failed to select microphone:", error);
      return { ok: false };
    }
  });

  // Handle last transcript updates from renderer
  ipcMain.on("transcript:update", (_event, text: string) => {
    console.log("[IPC] Received transcript update:", text.slice(0, 50) + (text.length > 50 ? "..." : ""));
    lastTranscript = text;
  });
});

app.on("window-all-closed", () => {
  // On macOS, keep app running in dock even when all windows are closed
});

app.on("activate", () => {
  console.log("[App Event] activate: Dock icon clicked or app activated");

  // Check if we have any visible windows first
  const allWindows = BrowserWindow.getAllWindows();
  const visibleWindows = allWindows.filter((window) => window.isVisible());

  console.log(
    `[App Event] activate: ${allWindows.length} total windows, ${visibleWindows.length} visible`,
  );

  if (visibleWindows.length === 0) {
    // No visible windows - show existing hidden windows or create new ones

    // First priority: show the home window if it exists but is hidden
    if (homeWindow && !homeWindow.isDestroyed() && !homeWindow.isVisible()) {
      console.log("[App Event] activate: Showing hidden home window");
      homeWindow.show();
      homeWindow.focus();
      return;
    }

    // Second priority: show the main window if it exists but is hidden
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.log("[App Event] activate: Showing hidden main window");
      mainWindow.show();
      return;
    }

    // If no windows exist at all, create the main window
    if (allWindows.length === 0) {
      console.log(
        "[App Event] activate: No windows exist, creating main window",
      );
      createWindow();
    }
    // If windows exist but are all destroyed/invalid, recreate main window
    else if (!mainWindow || mainWindow.isDestroyed()) {
      console.log("[App Event] activate: Main window is destroyed, recreating");
      createWindow();
    }
  } else {
    console.log(
      "[App Event] activate: Windows already visible, no action needed",
    );
  }
});

app.on("before-quit", () => {
  console.log("[App Event] before-quit: Setting isQuitting flag to true.");
  isQuitting = true;
});

app.on("will-quit", () => {
  console.log("[MainProcess] App is quitting.");

  // Clear restart timeout and kill fn-tap process
  if (fnRestartTimeout) {
    clearTimeout(fnRestartTimeout);
    fnRestartTimeout = null;
  }
  fnProc?.kill();
});

const createHomeWindow = () => {
  if (homeWindow) {
    homeWindow.focus();
    return;
  }

  const newWidth = 920;
  const newHeight = 470;

  homeWindow = new BrowserWindow({
    width: newWidth,
    height: newHeight,
    minWidth: newWidth,
    minHeight: newHeight,
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    show: false,
    title: "Sonic Flow Home",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      enableWebSQL: false,
    },
    icon: iconPath,
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    homeWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/home`);
  } else {
    const indexHtml = path.join(
      __dirname,
      `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
    );
    homeWindow.loadURL(`file://${indexHtml}#/home`);
  }

  homeWindow.setMenuBarVisibility(false);

  homeWindow.once("ready-to-show", () => {
    homeWindow?.show();
  });

  homeWindow.on("closed", () => {
    console.log("[Home Window Event] 'closed' event triggered.");
    homeWindow = null;
    console.log("[Home Window Event] homeWindow variable set to null.");
  });
};

function startFnListener() {
  // Clear any pending restart timer and reset permission flag
  if (fnRestartTimeout) {
    clearTimeout(fnRestartTimeout);
    fnRestartTimeout = null;
  }

  // Reset permission denied flag when explicitly starting listener
  // (e.g., on app startup or manual restart)
  fnPermissionDenied = false;

  // Clear any buffered stdout data from previous process
  fnStdoutBuffer = "";
  fnPermissionDialogShown = false;

  // Clean up existing process to prevent orphaned processes
  if (fnProc && !fnProc.killed) {
    console.log(
      "[FnListener] Cleaning up existing fn-tap process before starting new one",
    );
    try {
      fnProc.kill("SIGTERM");
    } catch (error) {
      console.warn(
        "[FnListener] Error killing existing fn-tap process:",
        error,
      );
    }
    fnProc = null;
  }

  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, "fn-tap")
    : path.join(app.getAppPath(), "native", "bin", "fn-tap");

  // Check if the helper binary exists before attempting to spawn
  if (!fs.existsSync(helperPath)) {
    console.error(
      `[FnListener] fn-tap binary not found at path: ${helperPath}`,
    );
    mainWindow?.webContents.send(
      "notify",
      "Fn key detection unavailable: binary missing",
    );
    return;
  }

  try {
    console.log(`[FnListener] Starting fn-tap helper from: ${helperPath}`);
    fnProc = spawn(helperPath, []);

    fnProc.stdout.setEncoding("utf8");
    fnProc.stdout.on("data", (chunk: string) => {
      // Append chunk to buffer to handle commands split across boundaries
      fnStdoutBuffer += chunk;

      // Process complete lines
      const lines = fnStdoutBuffer.split(/\r?\n/);

      // Keep the last (potentially incomplete) line in the buffer
      fnStdoutBuffer = lines.pop() || "";

      // Process complete lines
      lines.forEach((line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return; // Skip empty lines

        console.log(`[FnListener] Received command: "${trimmedLine}"`);

        if (trimmedLine === "down") {
          mainWindow?.webContents.send("ptt-down");
        } else if (trimmedLine === "up") {
          mainWindow?.webContents.send("ptt-up");
        } else if (trimmedLine === "perm-denied") {
          fnPermissionDenied = true;

          // Show tray notification immediately
          mainWindow?.webContents.send(
            "notify",
            "Grant Input Monitoring permission → restart",
          );

          // Debounce permission dialog to prevent multiple simultaneous dialogs
          if (!fnPermissionDialogShown) {
            fnPermissionDialogShown = true;
            console.log(
              "[FnListener] Permission denied detected, showing dialog",
            );

            dialog
              .showMessageBox({
                type: "warning",
                buttons: ["Open System Settings", "Cancel"],
                defaultId: 0,
                title: "Permission Required",
                message:
                  "Sonic Flow needs Input Monitoring permission to detect the Fn key.",
                detail:
                  "Please grant permission in System Settings ▸ Privacy & Security ▸ Input Monitoring, then restart the app.",
              })
              .then((result) => {
                if (result.response === 0) {
                  shell.openExternal(
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
                  );
                }
                // Reset debounce flag after dialog is dismissed (with a small delay to prevent rapid re-triggering)
                setTimeout(() => {
                  fnPermissionDialogShown = false;
                }, 2000);
              });
          } else {
            console.log(
              "[FnListener] Permission dialog already shown, ignoring duplicate perm-denied",
            );
          }
        } else {
          console.warn(
            `[FnListener] Unknown command received: "${trimmedLine}"`,
          );
        }
      });
    });

    fnProc.stderr?.on("data", (chunk: string) => {
      console.error(`[FnListener] fn-tap stderr: ${chunk.toString()}`);
    });

    fnProc.on("error", (error: Error) => {
      console.error(
        "[FnListener] Failed to start fn-tap helper process:",
        error,
      );
      fnProc = null;

      if (error.message.includes("ENOENT")) {
        console.error("[FnListener] fn-tap binary not found or not executable");
        mainWindow?.webContents.send(
          "notify",
          "Fn key detection unavailable: binary not found",
        );
      } else if (error.message.includes("EACCES")) {
        console.error("[FnListener] fn-tap binary lacks execution permissions");
        mainWindow?.webContents.send(
          "notify",
          "Fn key detection unavailable: permission denied",
        );
      } else {
        console.error(
          "[FnListener] Unknown error starting fn-tap:",
          error.message,
        );
        mainWindow?.webContents.send(
          "notify",
          "Fn key detection unavailable: startup error",
        );
      }

      // Schedule restart only if not already scheduled and not quitting
      scheduleRestart("error");
    });

    fnProc.on("close", (code, signal) => {
      console.log(
        `[FnListener] fn-tap helper process closed with code ${code}, signal ${signal}`,
      );
      fnProc = null;

      // Schedule restart only if not already scheduled and not quitting
      scheduleRestart("close");
    });

    fnProc.on("exit", (code, signal) => {
      console.log(
        `[FnListener] fn-tap helper process exited with code ${code}, signal ${signal}`,
      );
    });
  } catch (error) {
    console.error("[FnListener] Exception when spawning fn-tap helper:", error);
    fnProc = null;
    mainWindow?.webContents.send(
      "notify",
      "Fn key detection unavailable: spawn failed",
    );

    // Schedule restart only if not already scheduled and not quitting
    scheduleRestart("exception");
  }
}

function scheduleRestart(reason: string) {
  // Don't restart if already scheduled, if quitting, or if permissions were denied
  if (fnRestartTimeout || isQuitting || fnPermissionDenied) {
    if (fnPermissionDenied) {
      console.log(
        "[FnListener] Not scheduling restart due to permission denial. User must restart app after granting permissions.",
      );
      return;
    }
    console.log(
      `[FnListener] Not scheduling restart: already scheduled=${!!fnRestartTimeout}, quitting=${isQuitting}`,
    );
    return;
  }

  // Only auto-restart on crashes, not permission denials
  const delayMs = reason === "close" ? 5000 : 10000;
  console.log(
    `[FnListener] Scheduling restart in ${delayMs / 1000}s due to ${reason}...`,
  );

  fnRestartTimeout = setTimeout(() => {
    fnRestartTimeout = null;
    if (!fnPermissionDenied && !isQuitting) {
      console.log(`[FnListener] Executing scheduled restart due to ${reason}`);
      startFnListener();
    } else {
      console.log(
        `[FnListener] Skipping scheduled restart: permissions denied=${fnPermissionDenied}, quitting=${isQuitting}`,
      );
    }
  }, delayMs);
}
