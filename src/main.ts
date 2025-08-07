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
  systemPreferences,
} from "electron";
import path from "node:path";
import process from "node:process";
import { spawn, execFile, execSync } from "child_process";

import fs from "node:fs";

import {
  ISLAND_HIDDEN_Y,
  ISLAND_WIDTH,
  ISLAND_HEIGHT,
  ISLAND_VISIBLE_Y,
} from "./constants/window";
import {
  ONBOARDING_WIDTH,
  ONBOARDING_HEIGHT,
} from "./constants/onboarding";

// Microphone device management types
type MicDevice = { id: string; label: string };
type MicPreferences = { selectedMicId?: string };

// Add command line switches for WebGPU (currently disabled)
// app.commandLine.appendSwitch('enable-unsafe-webgpu');
// app.commandLine.appendSwitch('ignore-gpu-blocklist');

import { ChildProcess } from "child_process";
let mainWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const fnHelpers = new Set<ChildProcess>();
const pasteHelpers = new Set<ChildProcess>();
let fnProc: import("child_process").ChildProcessWithoutNullStreams | null =
  null;
let fnRestartTimeout: NodeJS.Timeout | null = null;
let fnPermissionDenied = false;
let fnStdoutBuffer = ""; // Buffer for incomplete lines from sonic-helper stdout
let fnPermissionDialogShown = false;

// Microphone management state
let micDevices: MicDevice[] = [
  { id: "default", label: "System Default" }, // Always available fallback
];
let micPreferences: MicPreferences = {};
let micPrefsPath: string; // Will be initialized in app.whenReady()

// Last transcript storage for context menu copy functionality
let lastTranscript = "";

// Floating bar hide timer management
let hideTimer: NodeJS.Timeout | null = null;
let hideEndTime: number | null = null;

function spawnHelper(
  path: string,
  args: string[] = [],
  isFnHelper: boolean,
) {
  const proc = spawn(path, args, { stdio: "pipe", detached: false });
  const helperSet = isFnHelper ? fnHelpers : pasteHelpers;
  helperSet.add(proc);
  proc.once("exit", () => helperSet.delete(proc));
  return proc;
}

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
  const otherDevices = devices.filter((d) => d.id !== "default");
  micDevices = [defaultDevice, ...otherDevices];

  console.log("[MicMgmt] Final device list with default:", micDevices);

  // Validate current selection still exists
  if (
    micPreferences.selectedMicId &&
    !micDevices.find((d) => d.id === micPreferences.selectedMicId)
  ) {
    console.log(
      "[MicMgmt] Selected device no longer available, resetting to default",
    );
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
  if (deviceId !== "default" && !micDevices.find((d) => d.id === deviceId)) {
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
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("mic:selected-changed", { id: selectedId });
  });
}

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
    hideEndTime = null;
    console.log("[Hide Timer] Timer cleared");
  }
}

function hideFloatingBarWithTimer(minutes: number | null): void {
  console.log(
    `[Hide Timer] Hiding floating bar for ${minutes ? minutes + " minutes" : "indefinitely"}`,
  );

  // Clear any existing timer
  clearHideTimer();

  // Hide the window
  if (mainWindow) {
    mainWindow.hide();

    // Set up timer if duration is specified
    if (minutes !== null) {
      hideEndTime = Date.now() + minutes * 60 * 1000;
      hideTimer = setTimeout(
        () => {
          console.log("[Hide Timer] Timer expired, showing floating bar");
          if (mainWindow) {
            mainWindow.show();
            mainWindow?.webContents.send(
              "notify",
              "Floating bar shown automatically",
            );
          }
          clearHideTimer();
        },
        minutes * 60 * 1000,
      );

      mainWindow?.webContents.send(
        "notify",
        `Floating bar hidden for ${minutes} minutes. Use tray menu to show early.`,
      );
    } else {
      mainWindow?.webContents.send(
        "notify",
        "Floating bar hidden indefinitely. Use tray menu to show again.",
      );
    }
  }
}

function buildFloatingBarMenuItems(): Electron.MenuItemConstructorOptions[] {
  if (!mainWindow) {
    return [];
  }

  const isVisible = mainWindow.isVisible();

  if (isVisible) {
    // Window is visible - show hide options with timing
    return [
      {
        label: "Hide Floating Bar",
        submenu: [
          {
            label: "For 5 minutes",
            click: () => {
              console.log("[Menu] Hide floating bar for 5 minutes");
              hideFloatingBarWithTimer(5);
            },
          },
          {
            label: "For 30 minutes",
            click: () => {
              console.log("[Menu] Hide floating bar for 30 minutes");
              hideFloatingBarWithTimer(30);
            },
          },
          {
            label: "For 1 hour",
            click: () => {
              console.log("[Menu] Hide floating bar for 1 hour");
              hideFloatingBarWithTimer(60);
            },
          },
          { type: "separator" },
          {
            label: "Indefinitely",
            click: () => {
              console.log("[Menu] Hide floating bar indefinitely");
              hideFloatingBarWithTimer(null);
            },
          },
        ],
      },
    ];
  } else {
    // Window is hidden - show option to show it
    let label = "Show Floating Bar";

    // If there's an active timer, show remaining time
    if (hideTimer && hideEndTime) {
      const remainingMs = hideEndTime - Date.now();
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
      if (remainingMinutes > 0) {
        label = `Show Floating Bar (${remainingMinutes}m remaining)`;
      }
    }

    return [
      {
        label,
        click: () => {
          console.log("[Menu] Show floating bar");
          clearHideTimer();
          if (mainWindow) {
            mainWindow.show();
            console.log("[Menu] Floating bar shown");
          }
        },
      },
    ];
  }
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
          console.log(
            `[Main Process] Found high-DPI tray icon at: ${tray2xPath}`,
          );
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

// Silent background check for app location
const checkAppLocationSilently = () => {
  if (!app.isPackaged) {
    console.log("[App Location Check] Skipping in development mode");
    return;
  }

  try {
    const appPath = app.getAppPath();
    console.log(`[App Location Check] Current app path: ${appPath}`);
    
    const needsMove = !appPath.startsWith('/Applications/') && (
      appPath.includes('/Documents/') ||
      appPath.includes('/Downloads/') ||
      appPath.includes('/Desktop/') ||
      appPath.includes('/Users/') // Catch other user directories
    );

    if (needsMove) {
      console.log("[App Location Check] App is not in Applications folder, showing toast");
      
      // Send notification to the main window (if it exists)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          "notify",
          "⚠️ Move Sonic Flow to Applications folder to enable hotkey detection"
        );
      }
      
      // Also show a tray notification if tray exists  
      if (tray && !tray.isDestroyed()) {
        tray.displayBalloon({
          title: "Sonic Flow",
          content: "Move Sonic Flow to the Applications folder to enable hotkey detection",
          icon: iconPath
        });
      }
    } else {
      console.log("[App Location Check] App is properly located in Applications folder");
    }
  } catch (error) {
    console.error("[App Location Check] Error checking app location:", error);
  }
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
    // Clear any active hide timer when window is shown
    clearHideTimer();
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

function createOnboardingWindow() {
  const onboardingWindowOptions: Electron.BrowserWindowConstructorOptions = {
    width: ONBOARDING_WIDTH,
    height: ONBOARDING_HEIGHT,
    frame: false,
    transparent: true, // crucial: no opaque backing store
    backgroundColor: "#00000000", // extra guard against fallback fill
    hasShadow: false,
    resizable: true,
    alwaysOnTop: false,
    focusable: true,
    skipTaskbar: false,
    show: false, // FIX 1: Don't show immediately - wait for content to load
    center: true,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  };

  // Add native macOS vibrancy for true glassmorphic effect
  if (process.platform === 'darwin') {
    onboardingWindowOptions.vibrancy = 'hud'; // 'sidebar' or 'fullscreen-ui' also work
    onboardingWindowOptions.visualEffectState = 'active'; // window remains vibrant when focused
    onboardingWindowOptions.titleBarStyle = 'hiddenInset'; // ① keep it frameless — we still get traffic-lights
    onboardingWindowOptions.trafficLightPosition = { x: 14, y: 14 }; // ③ nudge them if your design needs it (same numbers Raycast uses)
  } else {
    // Fallback for non-macOS platforms
    onboardingWindowOptions.backgroundColor = '#0f0f0f';
  }

  onboardingWindow = new BrowserWindow(onboardingWindowOptions);
  onboardingWindow.setMenuBarVisibility(false);

  const onboardingUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/onboarding`
    : `file://${path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
      )}#/onboarding`;

  console.log("[Onboarding] Loading URL:", onboardingUrl);
  console.log("[Onboarding] __dirname:", __dirname);
  console.log("[Onboarding] MAIN_WINDOW_VITE_NAME:", MAIN_WINDOW_VITE_NAME);
  
  onboardingWindow.loadURL(onboardingUrl);
  
  // Add error handling for loading issues
  onboardingWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error("[Onboarding] Failed to load:", errorCode, errorDescription, validatedURL);
  });

  // FIX 3: Wait for DOM and full rendering before showing window
  onboardingWindow.webContents.on('dom-ready', () => {
    console.log("[Onboarding] DOM ready");
  });

  // FIX 4: Use did-finish-load to ensure all resources are ready
  onboardingWindow.webContents.once('did-finish-load', () => {
    console.log("[Onboarding] Content finished loading");
    
    // FIX 8: Force hardware acceleration settings for better vibrancy
    if (process.platform === 'darwin') {
      onboardingWindow.webContents.executeJavaScript(`
        // Ensure proper rendering context
        document.documentElement.style.transform = 'translateZ(0)';
        console.log('[Vibrancy] Hardware acceleration enabled for rendering');
      `).catch((err) => {
        console.warn('[Vibrancy] Could not set hardware acceleration:', err);
      });
    }
    
    // FIX 5: Add small delay to ensure vibrancy effect is ready
    setTimeout(() => {
      if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        console.log("[Onboarding] Showing window after vibrancy delay");
        onboardingWindow.show();
        
        // FIX 6: Force invalidate shadow to clear any artifacts
        if (process.platform === 'darwin') {
          onboardingWindow.invalidateShadow();
        }
      }
    }, 100); // Small delay to let vibrancy settle
  });

  // FIX 7: Backup using ready-to-show as fallback
  onboardingWindow.once('ready-to-show', () => {
    console.log("[Onboarding] Ready to show event fired");
    // Only show if not already shown by did-finish-load
    setTimeout(() => {
      if (onboardingWindow && !onboardingWindow.isDestroyed() && !onboardingWindow.isVisible()) {
        console.log("[Onboarding] Showing window via ready-to-show fallback");
        onboardingWindow.show();
        
        if (process.platform === 'darwin') {
          onboardingWindow.invalidateShadow();
        }
      }
    }, 150);
  });

  onboardingWindow.on("closed", () => {
    onboardingWindow = null;
  });
}

function buildTrayMenu(): Electron.MenuItemConstructorOptions[] {
  console.log(
    "[Tray Menu] Building tray menu with",
    micDevices.length,
    "devices",
  );
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
    micDevices.forEach((device) => {
      micSubmenu.push({
        label: device.label,
        type: "radio",
        checked: device.id === selectedMicId,
        click: () => {
          console.log(
            `[Tray Menu] Microphone selected: ${device.label} (${device.id})`,
          );
          selectMicDevice(device.id);
        },
      });
    });
  }

  return [
    {
      label: "Open Settings",
      click: () => {
        console.log("[Tray Menu] Open Settings clicked");
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send("expand-pill");
        }
      },
    },
    ...buildFloatingBarMenuItems(),
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
          `mailto:rajkumar.sandheep@gmail.com?subject=Sonic%20Flow%20Feedback&body=Hi%20there!%0A%0ADescribe%20your%20feedback%20or%20issue%20here...%0A%0A---%0ASonic%20Flow%20${app.getVersion()}%0AmacOS%20${process.getSystemVersion()}`,
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
  console.log(
    "[Pill Menu] Building pill context menu with",
    micDevices.length,
    "devices",
  );
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
    micDevices.forEach((device) => {
      micSubmenu.push({
        label: device.label,
        type: "radio",
        checked: device.id === selectedMicId,
        click: () => {
          console.log(
            `[Pill Menu] Microphone selected: ${device.label} (${device.id})`,
          );
          selectMicDevice(device.id);
        },
      });
    });
  }

  return [
    {
      label: "Open Settings",
      click: () => {
        console.log("[Pill Menu] Open Settings clicked");
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send("expand-pill");
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
          mainWindow?.webContents.send(
            "notify",
            "Transcript copied to clipboard",
          );
        }
      },
    },
    ...buildFloatingBarMenuItems(),
    { type: "separator" },
    {
      label: "Send Feedback…",
      click: () => {
        console.log("[Pill Menu] Send Feedback clicked");
        // Open default email client with pre-filled feedback email
        const feedbackEmail = encodeURI(
          `mailto:rajkumar.sandheep@gmail.com?subject=Sonic%20Flow%20Feedback&body=Hi%20there!%0A%0ADescribe%20your%20feedback%20or%20issue%20here...%0A%0A---%0ASonic%20Flow%20${app.getVersion()}%0AmacOS%20${process.getSystemVersion()}`,
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
    console.log(
      `[Tray] Attempting to load tray template from: ${trayIconPath}`,
    );

    let icon = nativeImage.createFromPath(trayIconPath);

    if (icon.isEmpty()) {
      console.error(
        `[Tray] Failed to load tray icon from path: ${trayIconPath}. Using empty icon.`,
      );
      icon = nativeImage.createEmpty(); // Fallback to empty
    } else {
      console.log(
        `[Tray] Successfully loaded tray icon from path: ${trayIconPath}`,
      );
      const iconSize = icon.getSize();
      console.log(
        `[Tray] Loaded icon size: ${iconSize.width}x${iconSize.height} (should be 16x16 for base)`,
      );

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
    tray.on("click", () => {
      console.log("[Tray] 🎯 Tray menu opening - requesting device refresh");
      // Send refresh request to renderer processes before showing menu
      BrowserWindow.getAllWindows().forEach((window) => {
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

// Helper function to handle moving app to Applications folder
async function handleMoveToApplications() {
  if (process.platform !== 'darwin') {
    console.log("[Move to Applications] Not on macOS, skipping");
    return;
  }

  const appBundlePath = app.getAppPath();
  const isInApplications = appBundlePath.startsWith('/Applications/');
  const isDev = !app.isPackaged;
  
  // Don't prompt if already in Applications or in development
  if (isInApplications) {
    console.log("[Move to Applications] App is already in Applications folder");
    // Just open Finder to Applications folder to show it's already there
    await shell.openPath('/Applications');
    return;
  }
  
  if (isDev) {
    console.log("[Move to Applications] In development mode, opening Applications folder instead");
    await shell.openPath('/Applications');
    return;
  }
  
  const result = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Move to Applications', 'Cancel'],
    defaultId: 0,
    message: 'Move Sonic Flow to Applications folder?',
    detail: 'For the best experience, Sonic Flow should be installed in your Applications folder. This helps avoid permission issues.'
  });
  
  if (result.response === 0) {
    try {
      const destPath = '/Applications/Sonic Flow.app';
      // Use shell.trashItem to remove any existing version first
      if (fs.existsSync(destPath)) {
        await shell.trashItem(destPath);
      }
      // Copy the entire app bundle to Applications
      fs.cpSync(appBundlePath, destPath, { recursive: true });
      // Open the moved version
      shell.openPath(destPath);
      // Quit this instance
      app.quit();
    } catch (error) {
      console.error('Failed to move app to Applications:', error);
      // Show error dialog and open Applications folder as fallback
      await dialog.showErrorBox(
        'Move Failed',
        'Could not move Sonic Flow to Applications folder. Please move it manually.'
      );
      await shell.openPath('/Applications');
    }
  }
}

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
        ? path.join(process.resourcesPath, "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper")
        : path.join(app.getAppPath(), "native", "bin", "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper");

      if (!fs.existsSync(helperPath)) {
        console.error(
          `[PasteHelper] Sonic Flow Helper binary not found at path: ${helperPath}`,
        );
        mainWindow?.webContents.send(
          "notify",
          "Paste unavailable: binary missing. Copied to clipboard.",
        );
        return { success: false, error: "Paste helper binary not found." };
      }

      console.log(`[PasteHelper] Executing from: ${helperPath}`);
      const pasteProc = spawnHelper(helperPath, ["--mode=paste"], false);

      pasteProc.on("error", (error) => {
        console.error("[PasteHelper] Error executing paste-helper:", error);
        mainWindow?.webContents.send(
          "notify",
          "Paste failed. Grant Accessibility permission. Text copied.",
        );
      });

      let stdoutBuffer = "";
      pasteProc.stdout.on("data", (data) => {
        stdoutBuffer += data.toString();
      });

      let stderrBuffer = "";
      pasteProc.stderr.on("data", (data) => {
        stderrBuffer += data.toString();
      });

      pasteProc.on("close", (code) => {
        if (stdoutBuffer) {
          console.log(`[PasteHelper stdout]: ${stdoutBuffer.trim()}`);
        }
        if (stderrBuffer) {
          console.error(`[PasteHelper stderr]: ${stderrBuffer.trim()}`);
        }

        if (code === 0) {
          console.log("[PasteHelper] paste-helper executed successfully.");
          // If successful, restore the original clipboard content after a short delay.
          setTimeout(() => {
            console.log("[PasteHelper] Restoring original clipboard content.");
            clipboard.writeText(originalClipboardText);
          }, 300);
        } else {
          console.error(`[PasteHelper] Error: paste-helper exited with code ${code}`);
          mainWindow?.webContents.send(
            "notify",
            "Paste failed. Grant Accessibility permission. Text copied.",
          );
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

// Preference checking for first run
// Removed onboarding persistence - always show onboarding

app.whenReady().then(async () => {
  // Check if app should be moved to Applications folder (macOS only)
  if (process.platform === 'darwin') {
    const appBundlePath = app.getAppPath();
    const isInApplications = appBundlePath.startsWith('/Applications/');
    const isDev = !app.isPackaged;
    
    // Only prompt for move if not in Applications and not in development
    if (!isInApplications && !isDev) {
      const result = await dialog.showMessageBox({
        type: 'info',
        buttons: ['Move to Applications', 'Cancel'],
        defaultId: 0,
        message: 'Move Sonic Flow to Applications folder?',
        detail: 'For the best experience, Sonic Flow should be installed in your Applications folder. This helps avoid permission issues.'
      });
      
      if (result.response === 0) {
        try {
          const destPath = '/Applications/Sonic Flow.app';
          // Use shell.trashItem to remove any existing version first
          if (fs.existsSync(destPath)) {
            await shell.trashItem(destPath);
          }
          // Copy the entire app bundle to Applications
          fs.cpSync(appBundlePath, destPath, { recursive: true });
          // Open the moved version
          shell.openPath(destPath);
          // Quit this instance
          app.quit();
          return;
        } catch (error) {
          console.error('Failed to move app to Applications:', error);
          // Continue with normal startup if move fails
        }
      }
    }
  }

  // Initialize paths after app is ready to avoid keychain dialog
  micPrefsPath = path.join(app.getPath("userData"), "mic-preferences.json");
  
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

  // Always show onboarding - no persistence tracking
  console.log("[Startup] Always showing onboarding");
  createOnboardingWindow();

  // Initialize microphone preferences
  console.log("[Main Process] Initializing microphone preferences...");
  micPreferences = loadMicPreferences();
  console.log("[Main Process] Microphone preferences loaded:", micPreferences);

  // Silent background check for app location will be triggered after onboarding completes

  // Onboarding IPC handlers
  ipcMain.handle("helper:start", () => {
    console.log("[IPC] Starting helper process after onboarding");
    startFnListener();
    return { success: true };
  });

  ipcMain.handle("onboarding-complete", () => {
    console.log("[IPC] Onboarding complete, starting app");
    if (onboardingWindow) {
      onboardingWindow.close();
    }
    createWindow();
    createTray();
    startFnListener();
    
    // Run the silent app location check after main app is set up
    setTimeout(() => {
      checkAppLocationSilently();
    }, 2000); // Give time for main window and tray to initialize
  });

  // Handle pill context menu
  ipcMain.on("show-pill-context-menu", () => {
    console.log("[IPC Main] Received show-pill-context-menu event");
    if (mainWindow) {
      // Send refresh request to renderer processes before showing menu to ensure device list is current
      BrowserWindow.getAllWindows().forEach((window) => {
        console.log(
          "[Pill Menu] Sending mic:refresh-devices to window:",
          window.id,
        );
        window.webContents.send("mic:refresh-devices");
      });

      const menuTemplate = buildPillContextMenu();
      const contextMenu = Menu.buildFromTemplate(menuTemplate);
      contextMenu.popup({ window: mainWindow });
    }
  });

  // Handle pill expansion requests
  ipcMain.on("expand-pill", () => {
    console.log("[IPC Main] Received expand-pill event");
    if (mainWindow) {
      mainWindow.webContents.send("expand-pill");
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
  ipcMain.on(
    "mic:devices-update",
    (_event, payload: { devices: MicDevice[]; selectedId?: string }) => {
      console.log("[IPC] Received microphone devices update:", payload);
      updateMicDevices(payload.devices);
    },
  );

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
    console.log(
      "[IPC] Received transcript update:",
      text.slice(0, 50) + (text.length > 50 ? "..." : ""),
    );
    lastTranscript = text;
  });

  // Onboarding IPC handlers
  ipcMain.handle("check-permissions", async () => {
    try {
      const isDev = !app.isPackaged;
      const needAX = !systemPreferences.isTrustedAccessibilityClient(false);
      
      // Always use the helper binary for consistent permission checking in both dev and prod
      const helperPath = isDev
        ? path.join(app.getAppPath(), "native", "bin", "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper")
        : path.join(process.resourcesPath, "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper");
      
      // Check if the helper exists
      if (!fs.existsSync(helperPath)) {
        console.error("Sonic Flow Helper binary not found at path:", helperPath);
        return { needAX, needIM: true, isDev };
      }
      
      // Run the helper with --check-permissions flag
      return new Promise((resolve) => {
        const helper = spawn(helperPath, ["--check-permissions"]);
        
        let output = "";
        helper.stdout.on("data", (data) => {
          output += data.toString();
        });
        
        helper.on("close", () => {
          // Parse the output to determine if permissions are granted
          const hasAXPermission = output.includes("ax-granted");
          const hasIMPermission = output.includes("im-granted");
          resolve({ needAX: !hasAXPermission, needIM: !hasIMPermission, isDev });
        });
        
        // Timeout after 5 seconds
        setTimeout(() => {
          helper.kill();
          resolve({ needAX, needIM: true, isDev }); // Assume IM needed on timeout
        }, 5000);
      });
    } catch (error) {
      console.error("Error checking permissions:", error);
      // If we can't determine permissions, assume both are needed
      return { needAX: true, needIM: true, isDev: !app.isPackaged };
    }
  });

  ipcMain.handle("request-accessibility-permission", () => {
    try {
      systemPreferences.isTrustedAccessibilityClient(true);
      return { success: true };
    } catch (error) {
      console.error("Error requesting accessibility permission:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("request-microphone-permission", async () => {
    try {
      console.log("[IPC] Requesting microphone permission...");
      const granted = await systemPreferences.askForMediaAccess("microphone");
      console.log("[IPC] Microphone permission result:", granted);
      return { success: true, granted };
    } catch (error) {
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

  ipcMain.handle("open-system-preferences", async (event, pane: string) => {
    try {
      const { shell } = await import("electron");
      let url = "";
      
      switch (pane) {
        case "microphone":
          url = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
          break;
        case "accessibility":
          url = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
          break;
        case "input-monitoring":
          url = "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";
          break;
        case "location":
          // Handle moving app to Applications folder
          await handleMoveToApplications();
          return; // Don't open a URL for this case
        default:
          url = "x-apple.systempreferences:com.apple.preference.security";
      }
      
      await shell.openExternal(url);
      console.log(`[IPC] Opened System Preferences: ${pane}`);
    } catch (error) {
      console.error("Error opening System Preferences:", error);
    }
  });

    ipcMain.handle("request-input-monitoring-permission", async () => {
    try {
      const isDev = !app.isPackaged;
      console.log(`[${isDev ? 'Dev' : 'Prod'} Mode] Requesting input monitoring permission...`);
      
      const helperPath = isDev
        ? path.join(app.getAppPath(), "native", "bin", "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper")
        : path.join(process.resourcesPath, "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper");
      
      // First check if the helper exists
      if (!fs.existsSync(helperPath)) {
        console.error("Helper binary not found at:", helperPath);
        // Still open System Preferences even if helper is missing
        shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent");
        return { success: false, error: "Helper binary not found", isDev };
      }

      // Use our new registration functionality
      return new Promise((resolve) => {
        const helper = spawn(helperPath, ["--register-input-monitoring"], { 
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: false 
        });
          
        let stdout = '';
        let stderr = '';
        
        helper.stdout.on('data', (data) => {
          stdout += data.toString();
          console.log('[Helper Output]:', data.toString());
        });
        
        helper.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('[Helper Error]:', data.toString());
        });
        
        helper.on('close', (code) => {
          console.log(`[Helper] Registration process exited with code ${code}`);
          
          if (stdout.includes('registered-granted')) {
            console.log('[Helper] Input Monitoring permission already granted');
            resolve({ success: true, isDev, alreadyGranted: true });
          } else if (stdout.includes('registered-denied')) {
            console.log('[Helper] Input Monitoring permission not granted - user needs to enable in Settings');
            // Open System Preferences to Input Monitoring AFTER registration
            console.log('[Helper] Opening System Preferences to Input Monitoring...');
            shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent");
            console.log('[Helper] System Preferences opened');
            resolve({ success: true, isDev, alreadyGranted: false });
          } else {
            console.error('[Helper] Unexpected output from registration process');
            resolve({ success: false, error: "Unexpected helper output", isDev });
          }
        });
        
        helper.on('error', (error) => {
          console.error('[Helper] Error running registration process:', error);
          resolve({ success: false, error: error.message, isDev });
        });
      });
    } catch (error) {
      console.error("Error requesting input monitoring permission:", error);
      return { success: false, error: error.message, isDev: !app.isPackaged };
    }
  });

  // NEW: Add handler for the proper Input Monitoring request
  ipcMain.handle("ask-im", async () => {
    try {
      const isDev = !app.isPackaged;
      console.log(`[${isDev ? 'Dev' : 'Prod'} Mode] Asking for Input Monitoring permission...`);
      
      const helperPath = isDev
        ? path.join(app.getAppPath(), "native", "bin", "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper")
        : path.join(process.resourcesPath, "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper");
      
      if (!fs.existsSync(helperPath)) {
        console.error("Helper binary not found at:", helperPath);
        return { success: false, error: "Helper binary not found", isDev };
      }

      return new Promise((resolve) => {
        const helper = spawn(helperPath, ["--ask-im"], { 
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: false 
        });
          
        let stdout = '';
        let stderr = '';
        
        helper.stdout.on('data', (data) => {
          stdout += data.toString();
          console.log('[Ask-IM Output]:', data.toString());
        });
        
        helper.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('[Ask-IM Error]:', data.toString());
        });
        
        helper.on('close', (code) => {
          console.log(`[Ask-IM] Process exited with code ${code}`);
          
          if (stdout.includes('im-granted')) {
            console.log('[Ask-IM] Input Monitoring permission granted');
            resolve({ success: true, status: "authorized", isDev });
          } else if (stdout.includes('im-denied')) {
            console.log('[Ask-IM] Input Monitoring permission denied');
            resolve({ success: true, status: "denied", isDev });
          } else {
            console.error('[Ask-IM] Unexpected output from helper');
            resolve({ success: false, error: "Unexpected helper output", isDev });
          }
        });
        
        helper.on('error', (error) => {
          console.error('[Ask-IM] Error running helper:', error);
          resolve({ success: false, error: error.message, isDev });
        });
      });
    } catch (error) {
      console.error("Error asking for Input Monitoring permission:", error);
      return { success: false, error: error.message, isDev: !app.isPackaged };
    }
  });

  ipcMain.handle("reload-app", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle("get-app-path", () => {
    return app.getAppPath();
  });

  // Onboarding window controls
  ipcMain.handle("close-onboarding", () => {
    if (onboardingWindow) {
      onboardingWindow.close();
    }
  });

  ipcMain.handle("minimize-onboarding", () => {
    if (onboardingWindow) {
      onboardingWindow.minimize();
    }
  });

  ipcMain.handle("maximize-onboarding", () => {
    if (onboardingWindow) {
      if (onboardingWindow.isMaximized()) {
        onboardingWindow.unmaximize();
      } else {
        onboardingWindow.maximize();
      }
    }
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

    // Show the main window if it exists but is hidden
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
      // Always show onboarding
      createOnboardingWindow();
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
  isQuitting = true;

  // brutally nuke anything we forgot
  for (const p of [...fnHelpers, ...pasteHelpers]) {
    try {
      process.kill(p.pid, "SIGKILL");
    } catch {}
  }

  // **belts-and-suspenders**: kill anything matching the name
  try {
    execSync("pkill -9 -f 'Sonic Flow Helper' || true");
  } catch {}
  try {
    execSync("pkill -9 -f sonic-helper    || true");
  } catch {}
});

app.on("will-quit", () => {
  console.log("[MainProcess] App is quitting.");

  // Clear restart timeout and kill sonic-helper process
  if (fnRestartTimeout) {
    clearTimeout(fnRestartTimeout);
    fnRestartTimeout = null;
  }
  for (const p of [...fnHelpers, ...pasteHelpers]) {
    try {
      p.kill("SIGKILL");
    } catch {}
  }
});

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
      "[FnListener] Cleaning up existing sonic-helper process before starting new one",
    );
    try {
      fnProc.kill("SIGTERM");
    } catch (error) {
      console.warn(
        "[FnListener] Error killing existing sonic-helper process:",
        error,
      );
    }
    fnProc = null;
  }

  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper")
    : path.join(app.getAppPath(), "native", "bin", "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper");

  // Check if the helper binary exists before attempting to spawn
  if (!fs.existsSync(helperPath)) {
    console.error(
      `[FnListener] Sonic Flow Helper binary not found at path: ${helperPath}`,
    );

    const targetWindow = mainWindow || onboardingWindow;
    targetWindow?.webContents.send(
      "notify",
      "Fn key detection unavailable: binary missing",
    );
    return;
  }

  try {
    console.log(`[FnListener] Starting Sonic Flow Helper helper from: ${helperPath}`);
    fnProc = spawnHelper(helperPath, [], true) as import("child_process").ChildProcessWithoutNullStreams;

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

        const targetWindow = mainWindow || onboardingWindow;
        if (trimmedLine === "down") {
          targetWindow?.webContents.send("ptt-down");
        } else if (trimmedLine === "up") {
          targetWindow?.webContents.send("ptt-up");
        } else if (trimmedLine === "perm-denied") {
          fnPermissionDenied = true;

          // Show tray notification immediately
          targetWindow?.webContents.send(
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
      console.error(`[FnListener] Sonic Flow Helper stderr: ${chunk.toString()}`);
    });

    fnProc.on("error", (error: Error) => {
      console.error(
        "[FnListener] Failed to start Sonic Flow Helper helper process:",
        error,
      );
      fnProc = null;

      const targetWindow = mainWindow || onboardingWindow;
      if (error.message.includes("ENOENT")) {
        console.error("[FnListener] Sonic Flow Helper binary not found or not executable");
        targetWindow?.webContents.send(
          "notify",
          "Fn key detection unavailable: binary not found",
        );
      } else if (error.message.includes("EACCES")) {
        console.error("[FnListener] Sonic Flow Helper binary lacks execution permissions");
        targetWindow?.webContents.send(
          "notify",
          "Fn key detection unavailable: permission denied",
        );
      } else {
        console.error(
          "[FnListener] Unknown error starting Sonic Flow Helper:",
          error.message,
        );
        targetWindow?.webContents.send(
          "notify",
          "Fn key detection unavailable: startup error",
        );
      }

      // Schedule restart only if not already scheduled and not quitting
      scheduleRestart("error");
    });

    fnProc.on("close", (code, signal) => {
      console.log(
        `[FnListener] Sonic Flow Helper helper process closed with code ${code}, signal ${signal}`,
      );
      fnProc = null;

      // Schedule restart only if not already scheduled and not quitting
      scheduleRestart("close");
    });

    fnProc.on("exit", (code, signal) => {
      console.log(
        `[FnListener] Sonic Flow Helper helper process exited with code ${code}, signal ${signal}`,
      );
    });
  } catch (error) {
    console.error("[FnListener] Exception when spawning Sonic Flow Helper helper:", error);
    fnProc = null;

    const targetWindow = mainWindow || onboardingWindow;
    targetWindow?.webContents.send(
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
