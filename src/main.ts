import { app, BrowserWindow, Tray, globalShortcut, nativeImage, screen, ipcMain, clipboard, session, Menu, shell, dialog } from 'electron';
import path from 'node:path';
import process from 'node:process';
import started from 'electron-squirrel-startup';
import { spawn } from 'child_process';

import fs from 'node:fs';
import { execSync } from 'child_process';
import { transcribeAudioWithGroq } from './workers/groq-transcriber';
import { transcribeAudioWithGemini } from './workers/gemini-transcriber';



// Add command line switches for WebGPU - KEEP THESE
// app.commandLine.appendSwitch('enable-unsafe-webgpu');
// app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let notificationWindow: BrowserWindow | null = null;
let notificationTimeout: NodeJS.Timeout | null = null;
let isQuitting = false;
let homeWindow: BrowserWindow | null = null;
let fnProc: import('child_process').ChildProcessWithoutNullStreams | null = null;
let fnRestartTimeout: NodeJS.Timeout | null = null;
let fnPermissionDenied = false;
let fnStdoutBuffer = ''; // Buffer for incomplete lines from fn-tap stdout
let fnPermissionDialogShown = false; // Debounce flag for permission dialog

const PILL_W = 70;
const PILL_H = 15;
const PAD = 12; // 6px padding on each side

// FUCK IT - USE PNG FOR EVERYTHING! It works better at runtime
// Try multiple possible locations for the icon
const getIconPath = () => {
  const possiblePaths = [
    path.join(__dirname, 'assets', 'icon.png'),           // Vite build location
    path.join(__dirname, '..', 'assets', 'icon.png'),    // Alternative location
    path.join(process.resourcesPath, 'icon.png'),         // extraResource location
    path.join(__dirname, '..', '..', 'public', 'assets', 'icon.png') // Source location
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
  
  console.warn('[Main Process] No icon found in any expected location');
  return possiblePaths[0]; // fallback
};

const iconPath = getIconPath();

const createWindow = () => {
  // Create the browser window.
  const windowOptions: any = {
    width: PILL_W + PAD,
    height: PILL_H + PAD,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // Fully transparent background
    hasShadow: false, // <-- KILL the macOS shadow (= white block)
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      enableWebSQL: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: ['--enable-features=SharedArrayBuffer'],
    },
  };

  // Try to set the icon, but don't crash if it fails
  // Use PNG for all platforms - it works better at runtime
  const windowIconPath = iconPath;
  
  try {
    const icon = nativeImage.createFromPath(windowIconPath);
    if (!icon.isEmpty()) {
      windowOptions.icon = windowIconPath;
    } else {
      console.warn(`Icon not found at path: ${windowIconPath}, continuing without icon`);
    }
  } catch (error) {
    console.warn(`Failed to load icon: ${error.message}, continuing without icon`);
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

  // Show window inactive only when it's ready to prevent focus stealing
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('Main window shown.');
    // Note: DevTools disabled in production to maintain transparency on macOS
  });

  // Option 2 (as per suggestion): Use 'closed' event for logging after the fact
  mainWindow.on('closed', () => {
    console.log('Main window has been closed.');
    mainWindow = null; // Ensure reference is cleared
  });

  // Position window at the bottom center of the screen
  const { width, height } = mainWindow.getBounds();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  mainWindow.setPosition(Math.floor((screenWidth - width) / 2), screenHeight - height - 2);

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Hide menu bar
  mainWindow.setMenuBarVisibility(false);

  // Make window click-through except for the pill UI
  mainWindow.setIgnoreMouseEvents(false);

  // Add this handler to grant permissions needed for SharedArrayBuffer in some contexts
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    // In a real app, you might want to be more specific about which permissions
    // and origins you grant, but for local development/SAB, granting broadly is common.
    console.log(`Granting permission: ${permission} to ${webContents.getURL()}`);
    callback(true);
  });
};

const createTray = () => {
  try {
    // Check if tray already exists
    if (tray) {
      return;
    }
    
    // Load the icon from the assets folder
    const icon = nativeImage.createFromPath(iconPath);
    
    if (icon.isEmpty()) {
      console.error(`Failed to load tray icon from path: ${iconPath}. Using empty icon.`);
      tray = new Tray(nativeImage.createEmpty()); // Fallback to empty
    } else {
      console.log(`Successfully loaded tray icon from path: ${iconPath}`);
      tray = new Tray(icon);
    }
    
    tray.setToolTip('Sonic Flow');

    // Create native context menu
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Home',
        click: () => {
          console.log('[Tray Menu] Home clicked');
          if (homeWindow) {
            console.log('[Tray Menu] Home window exists, focusing...');
            homeWindow.focus();
          } else {
            console.log('[Tray Menu] Home window is null, creating new window...');
            createHomeWindow();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          console.log('[Tray Menu] Exit clicked');
          app.quit();
        }
      }
    ]);

    // Set the native context menu
    tray.setContextMenu(contextMenu);

  } catch (error) {
    console.error('Failed to create tray:', error);
    // Ensure tray is null if creation fails
    if (tray) tray.destroy();
    tray = null; 
  }
};

// Create the notification window (similar to context menu)
const createNotificationWindow = () => {
  if (notificationWindow) return;

  notificationWindow = new BrowserWindow({
    width: 180,
    height: 40,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    minimizable: false,
    maximizable: false,
    focusable: false, // Changed back to false since we don't need interaction
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: undefined,
    },
    backgroundColor: '#00000000',
    hasShadow: false
  });

  notificationWindow.on('closed', () => {
    console.log('Notification window closed.');
    notificationWindow = null;
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }
  });
};



// Add a handler for insert-text-at-cursor
ipcMain.handle('insert-text-at-cursor', async (_event: Electron.IpcMainInvokeEvent, text: string) => {
  let originalClipboardText: string | undefined = undefined;
  try {
    console.log('=== TEXT INSERTION PROCESS START ===');
    console.log('Received text:', text);

    originalClipboardText = clipboard.readText();
    console.log('Original clipboard text stored.');

    const trimmedText = text.trimStart(); 
    clipboard.writeText(trimmedText);
    console.log('Transcription text copied to clipboard');

    const activeWindow = BrowserWindow.getFocusedWindow();
    let operationSuccess = false;
    let operationError: string | null = null;
    const wasElectronWindowFocused = !!activeWindow; 

    if (wasElectronWindowFocused) {
      console.log('Electron window is focused. Skipping OS paste attempt.');
      operationSuccess = true; 
      showNotificationPopup('Output copied to clipboard');
    } else {
      console.log('No Electron window is focused, attempting macOS paste via AppleScript.');
      try {
        console.log('Executing paste command via AppleScript');
        execSync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
        console.log('macOS paste command executed successfully.');
        operationSuccess = true;
      } catch (err) {
        console.error('Failed to execute macOS paste command:', err);
        operationError = 'Unable to paste text. Please make sure a text field is focused.';
        operationSuccess = false;
      }

      if (operationSuccess) {
        clipboard.writeText(originalClipboardText);
        console.log('Original clipboard text restored after successful OS paste.');
      } else {
        console.log('OS paste failed. Transcription text remains in clipboard.');
        showNotificationPopup('Output copied to clipboard');
      }
    }

    if (!operationSuccess && !wasElectronWindowFocused) {
        console.log('=== TEXT INSERTION PROCESS FAILED (OS Paste Error) ===');
        return { success: false, error: operationError }; 
    }
    
    console.log('=== TEXT INSERTION PROCESS COMPLETE ===');
    return { success: true }; 

  } catch (error) {
    console.error('=== TEXT INSERTION PROCESS FAILED (Exception) ===');
    console.error('Error during text insertion:', error);
    showNotificationPopup('Output copied to clipboard (error)');
    console.log('Transcription text remains in clipboard due to error.');
    return {
      success: false,
      error: 'An error occurred during text insertion. Text copied to clipboard.'
    };
  }
});

app.whenReady().then(() => {
  console.log('[Main Process] Setting up onHeadersReceived listener for COOP/COEP...');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    });
  });
  console.log('[Main Process] onHeadersReceived listener configured.');

  app.commandLine.appendSwitch('disable-http-cache');
  
  // macOS dock icon setup
  try {
    // Try to set the dock icon explicitly (fallback if app bundle icon fails)
    const dockIcon = nativeImage.createFromPath(iconPath);
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
      console.log('[Main Process] Dock icon set successfully');
    }
  } catch (error) {
    console.warn('[Main Process] Failed to set dock icon:', error.message);
  }
  
  createWindow();
  createTray();
  createHomeWindow();
  createNotificationWindow();
  startFnListener();

  // Handy shortcut to toggle DevTools without breaking transparency
  globalShortcut.register('CommandOrControl+Alt+I', () => {
    const wc = mainWindow?.webContents;
    if (wc?.isDevToolsOpened()) wc.closeDevTools();
    else wc?.openDevTools({ mode: 'detach' });
  });

  // Handle pill context menu
  ipcMain.on('show-pill-context-menu', () => {
    console.log('[IPC Main] Received show-pill-context-menu event');
    if (mainWindow) {
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Home',
          click: () => {
            console.log('[Pill Menu] Home clicked');
            if (homeWindow) {
              homeWindow.focus();
            } else {
              createHomeWindow();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          click: () => {
            console.log('[Pill Menu] Exit clicked');
            app.quit();
          }
        }
      ]);
      
      contextMenu.popup({ window: mainWindow });
    }
  });

  ipcMain.on('show-notification', (event: Electron.IpcMainEvent, message: string) => {
    console.log(`[IPC Main] Received show-notification request from renderer: ${message}`);
    showNotificationPopup(message);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  console.log('[App Event] activate: Dock icon clicked or app activated');
  
  // Check if we have any visible windows first
  const allWindows = BrowserWindow.getAllWindows();
  const visibleWindows = allWindows.filter(window => window.isVisible());
  
  console.log(`[App Event] activate: ${allWindows.length} total windows, ${visibleWindows.length} visible`);
  
  if (visibleWindows.length === 0) {
    // No visible windows - show existing hidden windows or create new ones
    
    // First priority: show the home window if it exists but is hidden
    if (homeWindow && !homeWindow.isDestroyed() && !homeWindow.isVisible()) {
      console.log('[App Event] activate: Showing hidden home window');
      homeWindow.show();
      homeWindow.focus();
      return;
    }
    
    // Second priority: show the main window if it exists but is hidden
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.log('[App Event] activate: Showing hidden main window');
      mainWindow.show();
      return;
    }
    
    // If no windows exist at all, create the main window
    if (allWindows.length === 0) {
      console.log('[App Event] activate: No windows exist, creating main window');
      createWindow();
    }
    // If windows exist but are all destroyed/invalid, recreate main window
    else if (!mainWindow || mainWindow.isDestroyed()) {
      console.log('[App Event] activate: Main window is destroyed, recreating');
      createWindow();
    }
  } else {
    console.log('[App Event] activate: Windows already visible, no action needed');
  }
});

app.on('before-quit', () => {
  console.log('[App Event] before-quit: Setting isQuitting flag to true.');
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  console.log('[MainProcess] App is quitting. Unregistered all shortcuts.');
  
  // Clear restart timeout and kill fn-tap process
  if (fnRestartTimeout) {
    clearTimeout(fnRestartTimeout);
    fnRestartTimeout = null;
  }
  fnProc?.kill();
});

// === IPC Handlers for Hotkey Window (Registered ONCE) ===
// ipcMain.on('save-hotkey', (_event: Electron.IpcMainEvent, hotkey: string) => { ... });
// ipcMain.on('cancel-hotkey', (_event: Electron.IpcMainEvent) => { ... });
// === END IPC Handlers ===



const showNotificationPopup = (message: string, durationMs = 2000) => {
  if (!mainWindow) return;
  
  if (!notificationWindow) {
    console.log('Notification window not found, creating...');
    createNotificationWindow();
    if (!notificationWindow) {
      console.error('Failed to create notification window.');
      return;
    }
  }

  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
  }

  const pillBounds = mainWindow.getBounds();
  const notificationSize = notificationWindow.getSize();
  const notificationHeight = notificationSize[1];
  const posX = Math.floor(pillBounds.x + (pillBounds.width / 2) - (notificationSize[0] / 2));
  const gap = -5; 
  const posY = pillBounds.y - notificationHeight - gap; 

  console.log(`Positioning notification at x=${posX}, y=${posY} (using gap=${gap})`);
  notificationWindow.setPosition(posX, posY);

  const safeMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dynamicNotificationHtml = `
    <html>
    <head>
      <style>
        html, body { margin: 0; padding: 0; background-color: transparent; overflow: hidden; }
        body { color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; user-select: none; }
        .container { background-color: rgba(44, 44, 44, 0.95); border: 1px solid rgba(80, 80, 80, 0.8); border-radius: 12px; padding: 4px; overflow: hidden; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3); opacity: 0; transition: opacity 0.3s ease-in-out; }
        .container.visible { opacity: 1; }
        .message { font-size: 13px; padding: 6px 10px; text-align: center; white-space: nowrap; }
      </style>
    </head>
    <body> <div class="container"> <div class="message">${safeMessage}</div> </div> </body>
    </html>
  `;

  notificationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(dynamicNotificationHtml)}`);
  console.log(`Loading dynamic HTML into notification window with message: "${safeMessage}"`);

  notificationWindow.webContents.once('did-finish-load', () => {
    console.log('Notification window finished loading dynamic HTML. Adding visible class.');
    notificationWindow.webContents.executeJavaScript('document.querySelector(".container").classList.add("visible")', true);
    notificationWindow.showInactive();
  });

  notificationTimeout = setTimeout(() => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      console.log('Hiding notification window after timeout (removing visible class).');
      notificationWindow.webContents.executeJavaScript('document.querySelector(".container").classList.remove("visible")', true);
      setTimeout(() => {
        if (notificationWindow && !notificationWindow.isDestroyed()) {
          notificationWindow.hide();
        }
      }, 300); 
    }
    notificationTimeout = null;
  }, durationMs);
};

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
    show: false, 
    title: 'Sonic Flow Home',
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
    const indexHtml = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    homeWindow.loadURL(`file://${indexHtml}#/home`);
  }

  homeWindow.setMenuBarVisibility(false);

  homeWindow.once('ready-to-show', () => {
    homeWindow?.show();
  });

  homeWindow.on('closed', () => {
    console.log('[Home Window Event] \'closed\' event triggered.');
    homeWindow = null;
    console.log('[Home Window Event] homeWindow variable set to null.');
  });
};

ipcMain.handle('transcribe-groq', async (event, audioBuffer: ArrayBuffer, transferListAudio: Transferable[] | undefined, upstreamTimings?: Record<string, number>) => {
  console.log('[MainIPC] Received transcribe-groq request.');
  if (!audioBuffer || audioBuffer.byteLength === 0) {
    console.error('[MainIPC] Audio buffer is empty or null for Groq transcription.');
    return { transcript: '', error: 'Audio buffer is empty.', timings: upstreamTimings || {} };
  }
  
  try {
    const { text, timings: disjointTimingsFromHelper } = await transcribeAudioWithGroq(audioBuffer);
    
    console.log(`[MainIPC] Groq transcription successful: "${text.substring(0,30)}..." Returning timings from helper:`, Object.keys(disjointTimingsFromHelper));
    return { transcript: text, timings: disjointTimingsFromHelper };

  } catch (error: any) {
    console.error('[MainIPC] Error in transcribe-groq handler:', error);
    return { transcript: '', error: error.message || 'Groq transcription failed in main process.', timings: upstreamTimings || {} };
  }
});

ipcMain.handle('transcribe-gemini', async (event, arrayBuffer: ArrayBuffer, mimeType: string, transferListAudio: Transferable[] | undefined, upstreamTimings?: Record<string, number>) => {
  console.log('[MainIPC] Received transcribe-gemini request.');
  if (!arrayBuffer || !arrayBuffer.byteLength) {
    console.error('[MainIPC] Audio buffer is empty or null for Gemini transcription.');
    return { transcript: '', error: 'Audio buffer is empty.', timings: upstreamTimings || {} };
  }

  try {
    const { text, timings: disjointTimingsFromHelper } = await transcribeAudioWithGemini(arrayBuffer, mimeType);
    
    console.log(`[MainIPC] Gemini transcription successful: "${text.substring(0,30)}..." Returning timings from helper:`, Object.keys(disjointTimingsFromHelper));
    return { transcript: text, timings: disjointTimingsFromHelper };

  } catch (error: any) {
     console.error('[MainIPC] Error in transcribe-gemini handler:', error);
    return { transcript: '', error: error.message || 'Gemini transcription failed in main process.', timings: upstreamTimings || {} };
  }
});

function startFnListener(){
    if(process.platform!=='darwin') return;
    
    // Clear any pending restart timer and reset permission flag
    if (fnRestartTimeout) {
      clearTimeout(fnRestartTimeout);
      fnRestartTimeout = null;
    }
    
    // Reset permission denied flag when explicitly starting listener
    // (e.g., on app startup or manual restart)
    fnPermissionDenied = false;
    
    // Clear any buffered stdout data from previous process
    fnStdoutBuffer = '';
    fnPermissionDialogShown = false;
    
    // Clean up existing process to prevent orphaned processes
    if (fnProc && !fnProc.killed) {
      console.log('[FnListener] Cleaning up existing fn-tap process before starting new one');
      try {
        fnProc.kill('SIGTERM');
      } catch (error) {
        console.warn('[FnListener] Error killing existing fn-tap process:', error);
      }
      fnProc = null;
    }

    const helperPath = app.isPackaged
      ? path.join(process.resourcesPath, 'fn-tap')
      : path.join(app.getAppPath(), 'public', 'assets', 'fn-tap');
    
    // Check if the helper binary exists before attempting to spawn
    if (!fs.existsSync(helperPath)) {
      console.error(`[FnListener] fn-tap binary not found at path: ${helperPath}`);
      showNotificationPopup('Fn key detection unavailable: binary missing');
      return;
    }
      
    try {
      console.log(`[FnListener] Starting fn-tap helper from: ${helperPath}`);
      fnProc = spawn(helperPath, []);
      
      fnProc.stdout.setEncoding('utf8');
      fnProc.stdout.on('data', (chunk: string) => {
        // Append chunk to buffer to handle commands split across boundaries
        fnStdoutBuffer += chunk;
        
        // Process complete lines
        const lines = fnStdoutBuffer.split(/\r?\n/);
        
        // Keep the last (potentially incomplete) line in the buffer
        fnStdoutBuffer = lines.pop() || '';
        
        // Process complete lines
        lines.forEach((line: string) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return; // Skip empty lines
          
          console.log(`[FnListener] Received command: "${trimmedLine}"`);
          
          if (trimmedLine === 'down') {
            mainWindow?.webContents.send('ptt-down');
          } else if (trimmedLine === 'up') {
            mainWindow?.webContents.send('ptt-up');
          } else if (trimmedLine === 'perm-denied') {
            fnPermissionDenied = true;
            
            // Debounce permission dialog to prevent multiple simultaneous dialogs
            if (!fnPermissionDialogShown) {
              fnPermissionDialogShown = true;
              console.log('[FnListener] Permission denied detected, showing dialog');
              
              dialog.showMessageBox({
                type: 'warning',
                buttons: ['Open System Settings', 'Cancel'],
                defaultId: 0,
                title: 'Permission Required',
                message: 'Sonic Flow needs Input Monitoring permission to detect the Fn key.',
                detail: 'Please grant permission in System Settings ▸ Privacy & Security ▸ Input Monitoring, then restart the app.'
              }).then(result => {
                if (result.response === 0) {
                  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
                }
                // Reset debounce flag after dialog is dismissed (with a small delay to prevent rapid re-triggering)
                setTimeout(() => {
                  fnPermissionDialogShown = false;
                }, 2000);
              });
            } else {
              console.log('[FnListener] Permission dialog already shown, ignoring duplicate perm-denied');
            }
          } else {
            console.warn(`[FnListener] Unknown command received: "${trimmedLine}"`);
          }
        });
      });

      fnProc.stderr?.on('data', (chunk: string) => {
        console.error(`[FnListener] fn-tap stderr: ${chunk.toString()}`);
      });

      fnProc.on('error', (error: Error) => {
        console.error('[FnListener] Failed to start fn-tap helper process:', error);
        fnProc = null;
        
        if (error.message.includes('ENOENT')) {
          console.error('[FnListener] fn-tap binary not found or not executable');
          showNotificationPopup('Fn key detection unavailable: binary not found');
        } else if (error.message.includes('EACCES')) {
          console.error('[FnListener] fn-tap binary lacks execution permissions');
          showNotificationPopup('Fn key detection unavailable: permission denied');
        } else {
          console.error('[FnListener] Unknown error starting fn-tap:', error.message);
          showNotificationPopup('Fn key detection unavailable: startup error');
        }
        
        // Schedule restart only if not already scheduled and not quitting
        scheduleRestart('error');
      });

      fnProc.on('close', (code, signal) => {
        console.log(`[FnListener] fn-tap helper process closed with code ${code}, signal ${signal}`);
        fnProc = null;
        
        // Schedule restart only if not already scheduled and not quitting
        scheduleRestart('close');
      });

      fnProc.on('exit', (code, signal) => {
        console.log(`[FnListener] fn-tap helper process exited with code ${code}, signal ${signal}`);
      });

    } catch (error) {
      console.error('[FnListener] Exception when spawning fn-tap helper:', error);
      fnProc = null;
      showNotificationPopup('Fn key detection unavailable: spawn failed');
      
      // Schedule restart only if not already scheduled and not quitting
      scheduleRestart('exception');
    }
}

function scheduleRestart(reason: string) {
  // Don't restart if already scheduled, if quitting, or if permissions were denied
  if (fnRestartTimeout || isQuitting || fnPermissionDenied) {
    if (fnPermissionDenied) {
      console.log('[FnListener] Not scheduling restart due to permission denial. User must restart app after granting permissions.');
    }
    return;
  }
  
  const delayMs = reason === 'close' ? 5000 : 10000;
  console.log(`[FnListener] Scheduling restart in ${delayMs/1000}s due to ${reason}...`);
  
  fnRestartTimeout = setTimeout(() => {
    fnRestartTimeout = null;
    startFnListener();
  }, delayMs);
}
