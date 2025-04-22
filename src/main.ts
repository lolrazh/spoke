import { app, BrowserWindow, Tray, Menu, MenuItem, MenuItemConstructorOptions, globalShortcut, nativeImage, screen, ipcMain, dialog, nativeTheme, Notification } from 'electron';
import path from 'node:path';
import process from 'node:process';
import started from 'electron-squirrel-startup';
import { loadSettings, updateSetting } from './lib/settings';
import fs from 'node:fs';

// Suppress deprecation warnings
process.noDeprecation = true;

// Set up logging to file
const LOG_FILE = path.join(app.getPath('userData'), 'sonic-flow.log');
console.log(`Logging to file: ${LOG_FILE}`);

// Create a write stream for the log file
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// Override console.log, console.error, etc. to also write to the log file
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// 1. Define the restore function
function restoreConsole() {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
}

console.log = function(...args) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] [LOG] ${args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : arg
  ).join(' ')}`;
  
  // Check if stream is destroyed before writing
  if (logStream && !logStream.destroyed) { 
    try {
      logStream.write(message + '\n');
    } catch (err) {
      originalConsoleError('Error writing to log stream:', err);
    }
  }
  originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] [ERROR] ${args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : arg
  ).join(' ')}`;
  
  // Check if stream is destroyed before writing
  if (logStream && !logStream.destroyed) {
    try {
      logStream.write(message + '\n');
    } catch (err) {
      // If error writing error, just use original console
      originalConsoleError('Error writing error to log stream:', err);
    }
  }
  originalConsoleError.apply(console, args);
};

console.warn = function(...args) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] [WARN] ${args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : arg
  ).join(' ')}`;
  
  // Check if stream is destroyed before writing
  if (logStream && !logStream.destroyed) {
    try {
      logStream.write(message + '\n');
    } catch (err) {
      originalConsoleError('Error writing warning to log stream:', err);
    }
  }
  originalConsoleWarn.apply(console, args);
};

// Load environment variables first
import { loadEnv } from './lib/env';
console.log('Loading environment variables...');
loadEnv();

// Log the API key status (not the actual key)
console.log(`GROQ_API_KEY status in main.ts: ${process.env.GROQ_API_KEY ? 'set' : 'not set'}`);

// Import the transcription service after loading environment variables
import { transcribeAudio, cleanupTempFiles } from './lib/transcription';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let currentHotkey: string = '';
let hotkeyDialogOpen = false;
let captureWindow: BrowserWindow | null = null;
let contextMenuWindow: BrowserWindow | null = null;
let contextMenuOpen = false;
let notificationWindow: BrowserWindow | null = null;
let notificationTimeout: NodeJS.Timeout | null = null;
let isQuitting = false;

// Global variable to store the current recording state
let isRecording = false;
let recordingData: Buffer | null = null;

// Common hotkey combinations to offer as options
const HOTKEY_OPTIONS = [
  'Alt+Shift+D',
  'Alt+Shift+S',
  'Ctrl+Shift+D',
  'Ctrl+Alt+D',
  'Alt+D',
  'Ctrl+D'
];

// Determine the path to the icon file (works in both packaged and dev environments)
const iconPath = path.join(__dirname, 'assets', 'icon.ico');

// Optional: Remove the fs.existsSync check as it won't work reliably with asar
// if (!fs.existsSync(iconPath)) { // This check might fail with asar
//   console.error(`!!! Icon file not found at expected path: ${iconPath} !!!`);
// }

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 120,
    height: 35,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Disable features that cause warnings
      spellcheck: false,
      enableWebSQL: false,
    },
    // Set the window icon
    icon: iconPath,
  });

  // Also set the icon explicitly after creation (optional but good practice)
  mainWindow.setIcon(iconPath);

  // Show window inactive only when it's ready to prevent focus stealing
  mainWindow.once('ready-to-show', () => {
    mainWindow.showInactive();
    console.log('Main window shown inactive.');
  });

  // Handle window close event - Remove recursive quit
  // Option 1: Use 'close' but only log/nullify
  /*
  mainWindow.on('close', () => {
    console.log('Main window close event triggered (but not quitting here)');
    mainWindow = null; 
  });
  */
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

  // Register global shortcut from settings
  registerGlobalShortcut();

  // Pre-create the hotkey capture window for better performance
  createHotkeyCaptureWindow();
};

// Register the global shortcut based on settings
const registerGlobalShortcut = () => {
  // Unregister any existing shortcuts
  globalShortcut.unregisterAll();
  
  // Load settings to get the hotkey
  const settings = loadSettings();
  currentHotkey = settings.hotkey;
  
  // Register the shortcut
  try {
    globalShortcut.register(currentHotkey, () => {
      if (mainWindow) {
        // Send message to renderer process to toggle dictation
        mainWindow.webContents.send('toggle-dictation');
      }
    });
    console.log(`Registered global shortcut: ${currentHotkey}`);
  } catch (error) {
    console.error(`Failed to register shortcut ${currentHotkey}:`, error);
    // Show an error dialog to the user
    dialog.showErrorBox(
      'Hotkey Registration Failed',
      `Could not register the hotkey "${currentHotkey}". ` +
      `This might be due to missing permissions or the hotkey being used by another application. ` +
      `Please try changing the hotkey in the settings or ensure the application has the necessary permissions.`
    );
    // Set currentHotkey to empty string or null to indicate no active hotkey
    currentHotkey = ''; 
    // No fallback registration attempt - let the user fix it.
  }
};

// Handle hotkey change
const handleHotkeyChange = (newHotkey: string) => {
  if (newHotkey === currentHotkey) return;
  
  updateSetting('hotkey', newHotkey);
  currentHotkey = newHotkey;
  registerGlobalShortcut();
};

// Create the hotkey capture window once and reuse it
const createHotkeyCaptureWindow = () => {
  if (captureWindow) return;
  
  // Create a frameless window that looks like a menu
  captureWindow = new BrowserWindow({
    width: 200, // Reduced from 220
    height: 125,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false, // Disabled for security
    },
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    hasShadow: true
  });
  
  // HTML for key capture UI - simplified to match native context menu
  const captureHtml = `
    <html>
    <head>
      <style>
        html, body {
          margin: 0;
          padding: 0;
          background-color: transparent;
          overflow: hidden;
        }
        
        body {
          margin: 0;
          padding: 0;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          overflow: hidden;
          user-select: none;
          box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        }
        
        .container {
          background-color: #2c2c2c;
          border: 1px solid #444444;
          border-radius: 12px;
          padding: 4px; /* Reduced container padding */
          overflow: hidden;
        }
        
        .capture-area {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 4px 0; /* Reduced from 6px to 4px to match container padding */
        }
        
        .key-display {
          font-size: 13px;
          padding: 5px 8px; /* Reduced horizontal padding */
          margin: 5px 0;
          background-color: #3c3c3c;
          border-radius: 6px; /* Increased from 3px to 6px for more rounded corners */
          text-align: center;
          width: 170px; /* Reduced width */
          min-height: 18px;
        }
        
        .key-display.listening {
          border: 1px solid #555555;
        }
        
        .hint {
          font-size: 11px;
          color: #aaaaaa;
          margin-top: 3px;
          text-align: center;
        }
        
        .buttons {
          display: flex;
          justify-content: flex-end;
          margin-top: 4px;
          margin-bottom: 2px;
        }
        
        button {
          background-color: transparent;
          border: none;
          color: #ffffff;
          padding: 4px 6px; /* Reduced horizontal padding to match context menu */
          font-size: 12px;
          cursor: pointer;
          border-radius: 6px; /* Increased from 4px to 6px for more rounded corners */
        }
        
        button:hover {
          background-color: #3c3c3c;
          border-radius: 6px; /* Increased from 4px to 6px to match non-hover state */
        }
        
        button.primary {
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="capture-area">
          <div id="keyDisplay" class="key-display listening">Press a key combination</div>
          <div class="hint">Press modifier + key (e.g. Alt+Shift+D)</div>
        </div>
        <div class="buttons">
          <button id="cancelBtn">Cancel</button>
          <button id="saveBtn" class="primary" disabled>Save</button>
        </div>
      </div>
      
      <script>
        const { ipcRenderer } = require('electron');
        const keyDisplay = document.getElementById('keyDisplay');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        
        let capturedHotkey = '';
        let currentHotkey = '';
        
        // Reset the UI when shown and display current hotkey
        ipcRenderer.on('reset-ui', (_, hotkey) => {
          currentHotkey = hotkey;
          capturedHotkey = '';
          
          // Show current hotkey
          keyDisplay.textContent = currentHotkey || 'No hotkey set';
          keyDisplay.classList.remove('listening');
          saveBtn.disabled = true;
        });
        
        // Capture key combinations
        document.addEventListener('keydown', (e) => {
          // Only capture keys if in listening mode
          if (!keyDisplay.classList.contains('listening')) return;
          
          e.preventDefault();
          
          // Get modifiers
          const modifiers = [];
          if (e.altKey) modifiers.push('Alt');
          if (e.ctrlKey) modifiers.push('Ctrl');
          if (e.shiftKey) modifiers.push('Shift');
          if (e.metaKey) modifiers.push(navigator.platform.includes('Mac') ? 'Command' : 'Super');
          
          // Get the key
          let key = e.key;
          
          // Skip if only modifier keys are pressed
          if (['Alt', 'Control', 'Shift', 'Meta'].includes(key)) {
            return;
          }
          
          // Format the key (capitalize first letter for letters)
          if (key.length === 1) {
            key = key.toUpperCase();
          }
          
          // Create the hotkey string
          if (modifiers.length > 0) {
            capturedHotkey = [...modifiers, key].join('+');
            keyDisplay.textContent = capturedHotkey;
            keyDisplay.classList.remove('listening');
            saveBtn.disabled = false;
          }
        });
        
        // Click to start capturing a new hotkey
        keyDisplay.addEventListener('click', () => {
          keyDisplay.textContent = 'Press a key combination';
          keyDisplay.classList.add('listening');
          capturedHotkey = '';
          saveBtn.disabled = true;
        });
        
        // Save button
        saveBtn.addEventListener('click', () => {
          if (capturedHotkey) {
            ipcRenderer.send('save-hotkey', capturedHotkey);
          }
        });
        
        // Cancel button
        cancelBtn.addEventListener('click', () => {
          ipcRenderer.send('cancel-hotkey');
        });
      </script>
    </body>
    </html>
  `;
  
  // Load the HTML
  captureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(captureHtml)}`);
  
  // Handle blur (clicking outside)
  captureWindow.on('blur', () => {
    hideHotkeyCaptureWindow();
  });
  
  // Handle close
  captureWindow.on('closed', () => {
    console.log('Hotkey capture window closed.');
    captureWindow = null;
    if (!isQuitting) {
      console.log('Recreating hotkey capture window.');
      createHotkeyCaptureWindow(); // Recreate for next use
    } else {
      console.log('Not recreating hotkey capture window because app is quitting.');
    }
  });
};

// Show the hotkey capture window
const showHotkeyCaptureWindow = () => {
  if (hotkeyDialogOpen || !mainWindow || !captureWindow) return;
  hotkeyDialogOpen = true;
  
  // Position above the pill
  const pillBounds = mainWindow.getBounds();
  const captureSize = captureWindow.getSize();
  
  // Position centered above the pill with a smaller gap to be closer to the pill
  captureWindow.setPosition(
    Math.floor(pillBounds.x + (pillBounds.width / 2) - (captureSize[0] / 2)),
    pillBounds.y - captureSize[1] - 2 // Reduced vertical offset from 5 to 2 to be even closer to the pill
  );
  
  // Reset the UI and pass the current hotkey
  captureWindow.webContents.send('reset-ui', currentHotkey);
  
  // Show the window
  captureWindow.show();
};

// Hide the hotkey capture window
const hideHotkeyCaptureWindow = () => {
  if (!hotkeyDialogOpen || !captureWindow) return;
  hotkeyDialogOpen = false;
  captureWindow.hide();
};

// Validate hotkey format
const isValidHotkeyFormat = (hotkey: string): boolean => {
  // Basic validation - should contain at least one modifier and a key
  const modifiers = ['Alt', 'Shift', 'Ctrl', 'Command', 'Option', 'Super'];
  return modifiers.some(modifier => hotkey.includes(modifier)) && 
         hotkey.includes('+') &&
         hotkey.split('+').length >= 2;
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

    // Listen for right-click events on the tray icon
    tray.on('right-click', (event, bounds) => {
      console.log(`[Tray Event] Right-click detected on tray icon at bounds: x=${bounds.x}, y=${bounds.y}, w=${bounds.width}, h=${bounds.height}`);
      // Use the bottom-right corner of the bounds as the anchor
      const anchorX = bounds.x + bounds.width;
      const anchorY = bounds.y + bounds.height;
      console.log(`[Tray Event] Calculated menu anchor: x=${anchorX}, y=${anchorY}`);
      // Show the custom HTML context menu, aligning bottom-right to anchor
      showContextMenu(anchorX, anchorY);
    });

    // Optional: Handle left-click if needed (e.g., toggle main window?)
    // tray.on('click', () => {
    //   console.log('[Tray Event] Left-click detected.');
    //   // Example: mainWindow?.show();
    // });

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

// Create the custom context menu window
const createContextMenuWindow = () => {
  if (contextMenuWindow) return;
  
  // Create a frameless window that looks like a menu
  contextMenuWindow = new BrowserWindow({
    width: 140, // Further reduced width from 160 to 140
    height: 150,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      // Use the new preload script
      preload: path.join(__dirname, 'contextmenu-preload.js'), // Correct path for build output
      contextIsolation: true, // Enable context isolation (required for contextBridge)
      nodeIntegration: false, // Keep nodeIntegration disabled for security
    },
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    hasShadow: true
  });
  
  // HTML for context menu UI - styled to match the hotkey selection menu
  const contextMenuHtml = `
    <html>
    <head>
      <style>
        html, body {
          margin: 0;
          padding: 0;
          background-color: transparent;
          overflow: hidden;
        }
        
        body {
          margin: 0;
          padding: 0;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          overflow: hidden;
          user-select: none;
          box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        }
        
        .container {
          background-color: #2c2c2c;
          border: 1px solid #444444;
          border-radius: 12px;
          padding: 4px; /* Reduced container padding */
          overflow: hidden;
        }
        
        .menu-items {
          display: flex;
          flex-direction: column;
          width: 100%;
          padding: 0; /* Removed vertical padding */
        }
        
        .menu-item {
          font-size: 12px;
          padding: 4px 6px; /* Changed from 6px 6px to 4px 6px to make padding consistent */
          margin: 2px 0;
          cursor: pointer;
          border-radius: 6px; /* Increased from 4px to 6px for more rounded corners */
          text-align: left;
          color: #ffffff;
          background-color: transparent;
          border: none;
          width: auto; /* Let the button size naturally */
          display: block;
        }
        
        .menu-item:hover {
          background-color: #3c3c3c;
          border-radius: 6px; /* Increased from 4px to 6px to match non-hover state */
        }
        
        .separator {
          height: 1px;
          background-color: #444444;
          margin: 4px 0; /* Consistent margin */
          width: 100%;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="menu-items">
          <button id="accountBtn" class="menu-item">Account</button>
          <button id="hotkeyBtn" class="menu-item">Change Hotkey</button>
          <div class="separator"></div>
          <button id="exitBtn" class="menu-item">Exit</button>
        </div>
      </div>
      
      <script>
        // Remove require('electron') - no longer needed and wouldn't work anyway
        // const { ipcRenderer } = require('electron'); 
        
        // Ensure the API is available before adding listeners
        if (window.contextMenuAPI) {
          // Set up button click handlers using the exposed API
          document.getElementById('accountBtn').addEventListener('click', () => {
            window.contextMenuAPI.send('menu-account');
          });
          
          document.getElementById('hotkeyBtn').addEventListener('click', () => {
            window.contextMenuAPI.send('menu-hotkey');
          });
          
          document.getElementById('exitBtn').addEventListener('click', () => {
            console.log('[Context Menu] Exit button clicked, sending menu-exit IPC via contextMenuAPI...');
            window.contextMenuAPI.send('menu-exit');
          });
        } else {
          console.error('[Context Menu] contextMenuAPI not found on window object!');
        }
      </script>
    </body>
    </html>
  `;
  
  // Load the HTML
  contextMenuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(contextMenuHtml)}`);
  
  // Handle blur (clicking outside)
  contextMenuWindow.on('blur', () => {
    hideContextMenu();
  });
  
  // Handle close
  contextMenuWindow.on('closed', () => {
    console.log('Context menu window closed.');
    contextMenuWindow = null;
    if (!isQuitting) {
      console.log('Recreating context menu window.');
      createContextMenuWindow(); // Recreate for next use
    } else {
      console.log('Not recreating context menu window because app is quitting.');
    }
  });
};

// Show the custom context menu
// Accepts anchorX, anchorY coordinates for positioning the bottom-right corner
const showContextMenu = (anchorX?: number, anchorY?: number) => {
  if (contextMenuOpen || !contextMenuWindow) return;
  // If anchor coordinates are not provided, we can't position correctly.
  // Log an error or decide on a default position (e.g., screen center?).
  if (anchorX === undefined || anchorY === undefined) {
    console.error('[showContextMenu] Called without anchor coordinates. Cannot position menu.');
    // Optionally, implement a fallback position here if needed
    // For now, just return to prevent errors
    return; 
  }
  
  contextMenuOpen = true;
  
  const menuSize = contextMenuWindow.getSize();
  console.log(`[showContextMenu] Menu size obtained: width=${menuSize[0]}, height=${menuSize[1]}`);
  const menuWidth = menuSize[0];
  const menuHeight = menuSize[1];

  // --- Restore Bottom-Right Alignment Logic --- 
  // Calculate top-left position to align the menu's bottom-right corner 
  // with the anchor point (cursor or tray corner).
  let positionX = anchorX - menuWidth;
  let positionY = anchorY - menuHeight;

  // --- Optional Fine-Tuning --- 
  // Adjust slightly if visual alignment isn't perfect due to borders, shadows, etc.
  const fineTuneX = 0; // Adjust this value (e.g., +2 or -3) if needed
  const fineTuneY = 0; // Adjust this value (e.g., +2 or -3) if needed
  positionX += fineTuneX;
  positionY += fineTuneY;

  console.log(`[showContextMenu] Positioning menu top-left at: x=${positionX}, y=${positionY} (to align bottom-right with anchor x=${anchorX}, y=${anchorY}, fineTuneX=${fineTuneX}, fineTuneY=${fineTuneY})`);

  // Set the calculated top-left position
  contextMenuWindow.setPosition(positionX, positionY);
  
  // Show the window
  contextMenuWindow.show();
};

// Hide the context menu
const hideContextMenu = () => {
  if (!contextMenuOpen || !contextMenuWindow) return;
  contextMenuOpen = false;
  contextMenuWindow.hide();
};

// Add a handler for insert-text-at-cursor
ipcMain.handle('insert-text-at-cursor', async (_, text) => {
  let originalClipboardText: string | undefined = undefined;
  try {
    console.log('=== TEXT INSERTION PROCESS START ===');
    console.log('Received text:', text);

    // Read and store the current clipboard content (text only)
    const { clipboard } = require('electron');
    originalClipboardText = clipboard.readText();
    console.log('Original clipboard text stored.');

    // Copy the transcription text to clipboard
    const trimmedText = text.trimStart(); // Trim leading whitespace
    clipboard.writeText(trimmedText);
    console.log('Transcription text copied to clipboard');

    // Check if an Electron window is focused
    const activeWindow = BrowserWindow.getFocusedWindow();
    let operationSuccess = false;
    let operationError: string | null = null;
    let wasElectronWindowFocused = !!activeWindow; // Track if an electron window was initially focused

    if (wasElectronWindowFocused) {
      // Electron window is focused: Skip paste attempt
      console.log('Electron window is focused. Skipping OS paste attempt.');
      operationSuccess = true; // Considered success as text is on clipboard
      showNotificationPopup('Output copied to clipboard');
      // Do NOT restore original clipboard

    } else {
      // No Electron window focused: Attempt OS-level paste
      console.log('No Electron window is focused, attempting OS-level paste.');
      try {
        const { execSync } = require('child_process');
        if (process.platform === 'win32') {
          console.log('Executing paste command via PowerShell');
          execSync('powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys(\'^v\')"');
        } else if (process.platform === 'darwin') {
          console.log('Executing paste command via AppleScript');
          execSync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
        } else if (process.platform === 'linux') {
          console.log('Executing paste command via xdotool');
          execSync('xdotool key ctrl+v');
        } else {
          throw new Error('Unsupported platform for OS-level paste');
        }
        console.log('OS paste command executed successfully.');
        operationSuccess = true;
      } catch (err) {
        console.error('Failed to execute OS paste command:', err);
        operationError = 'Unable to paste text. Please make sure a text field is focused.';
        operationSuccess = false;
      }

      // Restore the original clipboard content ONLY if OS paste was successful
      if (operationSuccess) {
        clipboard.writeText(originalClipboardText);
        console.log('Original clipboard text restored after successful OS paste.');
      } else {
        console.log('OS paste failed. Transcription text remains in clipboard.');
        showNotificationPopup('Output copied to clipboard');
      }
    }

    // If OS paste failed, we still return failure to the renderer
    if (!operationSuccess && !wasElectronWindowFocused) {
        console.log('=== TEXT INSERTION PROCESS FAILED (OS Paste Error) ===');
        return { success: false, error: operationError }; 
    }
    
    // Return final status (success means either paste worked or text is on clipboard because electron window was focused)
    console.log('=== TEXT INSERTION PROCESS COMPLETE ===');
    return { success: true }; // Return success even if only copied

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

// Clean up temporary files when the app quits
app.on('quit', () => {
  console.log('[App Event] quit: Handler running.');
  try {
    cleanupTempFiles();
    console.log('[App Event] quit: Temp files cleaned.');
  } catch (error) {
    console.error('[App Event] quit: Error cleaning temp files:', error);
  }
});

// Add IPC handlers for audio recording and transcription
ipcMain.handle('start-recording', async () => {
  console.log('Main process: Recording started');
  
  // Reset state
  if (isRecording) {
    console.log('Warning: Recording was already active, resetting state');
  }
  
  isRecording = true;
  recordingData = null;
  return { success: true };
});

ipcMain.handle('stop-recording', async () => {
  console.log('Main process: Recording stopped');
  
  // Check if recording was active
  if (!isRecording) {
    console.log('Warning: Recording was not active, but stop was requested');
  }
  
  // Reset state
  isRecording = false;
  
  // Clear any stored recording data to prevent memory leaks
  if (recordingData) {
    console.log('Main process: Clearing stored recording data');
    recordingData = null;
  }
  
  return { success: true };
});

ipcMain.handle('transcribe-audio', async (_, audioData) => {
  try {
    console.log('=== TRANSCRIPTION PROCESS START ===');
    console.log('Received audio data for transcription, length:', audioData?.length || 0, 'bytes');
    
    // Validate audio data
    if (!audioData || audioData.length === 0) {
      console.error('Received empty audio data');
      return { success: false, error: 'Empty audio data received' };
    }
    
    // Ensure audioData is a Buffer
    let audioBuffer;
    if (Buffer.isBuffer(audioData)) {
      console.log('Audio data is already a Buffer');
      audioBuffer = audioData;
    } else if (audioData instanceof Uint8Array || Array.isArray(audioData)) {
      console.log('Converting audio data from Uint8Array/Array to Buffer');
      audioBuffer = Buffer.from(audioData);
      console.log('Converted to Buffer, new size:', audioBuffer.length, 'bytes');
    } else {
      console.error('Received invalid audio data type');
      return { success: false, error: 'Invalid audio data format' };
    }
    
    // Store the audio data
    recordingData = audioBuffer;
    
    console.log('Sending audio to Groq API for transcription...');
    
    // Transcribe the audio
    let text;
    try {
      text = await transcribeAudio(audioBuffer);
      console.log('Transcription successful, result:', text);
    } catch (transcriptionError) {
      console.error('Transcription API error:', transcriptionError);
      return { success: false, error: `Transcription API error: ${transcriptionError.message}` };
    }
    
    if (!text || text.trim() === '') {
      console.error('Transcription returned empty text');
      return { success: false, error: 'Transcription returned empty text' };
    }
    
    console.log('Transcription result:', text);
    console.log('=== TRANSCRIPTION PROCESS COMPLETE ===');
    
    // Clear recording data after successful transcription
    recordingData = null;
    
    return { success: true, text };
  } catch (error) {
    console.error('=== TRANSCRIPTION PROCESS FAILED ===');
    console.error('Error transcribing audio:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
});

// Add a handler to view the log file
ipcMain.handle('view-log-file', async () => {
  try {
    console.log('Attempting to open log file');
    
    // Check if the log file exists
    if (fs.existsSync(LOG_FILE)) {
      // Open the log file in the default text editor
      const { shell } = require('electron');
      await shell.openPath(LOG_FILE);
      console.log('Log file opened successfully');
      return { success: true };
    } else {
      console.error('Log file does not exist');
      return { success: false, error: 'Log file does not exist' };
    }
  } catch (error) {
    console.error('Failed to open log file:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // Set disk cache options to avoid cache errors
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-http-cache');
  
  createWindow();
  createTray();
  createContextMenuWindow();
  createNotificationWindow();

  // Set up IPC handler for showing the custom context menu (from pill click)
  ipcMain.on('show-context-menu', (event) => {
    console.log(`[IPC Main] Received show-context-menu event from pill.`);
    // Get cursor position directly from the screen module
    const { x: anchorX, y: anchorY } = screen.getCursorScreenPoint();
    console.log(`[IPC Main] Cursor position from screen: x=${anchorX}, y=${anchorY}`);
        
    // Call showContextMenu with screen coordinates
    showContextMenu(anchorX, anchorY); 
  });

  // Set up IPC handler for showing notifications requested by the renderer
  ipcMain.on('show-notification', (event, message: string) => {
    console.log(`[IPC Main] Received show-notification request from renderer: ${message}`);
    showNotificationPopup(message);
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // Standard behavior: Quit when all windows are closed (except on macOS).
  console.log('[App Event] window-all-closed - Checking platform...');
  if (process.platform !== 'darwin') {
    console.log('[App Event] window-all-closed - Platform is not macOS, calling app.quit().');
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  console.log('[App Event] before-quit: Setting isQuitting flag to true.');
  isQuitting = true;
  // Note: We keep essential cleanup in will-quit as it runs AFTER windows close attempt
});

app.on('will-quit', () => {
  // This should finally run now!
  console.log('[App Event] will-quit: Handler running...');
  try {
    // Perform cleanup (shortcuts, etc.)
    console.log('[App Event] will-quit: Unregistering shortcuts...');
    globalShortcut.unregisterAll();
    console.log('[App Event] will-quit: Shortcuts unregistered.');

    // *** Final log before closing stream ***
    console.log('[App Event] will-quit: Preparing to close log stream...');

    // 2. Restore original console functions BEFORE ending the stream
    restoreConsole();

    // 3. End the stream
    if (logStream) {
      try {
        // No more console logs here!
        logStream.end();
      } catch (error) {
        // Use original console if error happens during stream end
        originalConsoleError('[App Event] will-quit: Error closing log stream:', error);
      }
    }
    // *** NO MORE LOGGING HERE ***
  } catch (error) {
    // Use original console for errors during cleanup
    originalConsoleError('[App Event] will-quit: Error during cleanup:', error);
    // Ensure console is restored even if error occurred before restoreConsole() call
    restoreConsole(); 
    // Attempt to end stream again if it exists and error happened before ending
    if (logStream && !logStream.writableEnded) { 
      try { logStream.end(); } catch (e) { /* Ignore secondary error */ }
    }
  }
});

// === IPC Handlers for Hotkey Window (Registered ONCE) ===
ipcMain.on('save-hotkey', (_, hotkey: string) => {
  if (isValidHotkeyFormat(hotkey)) {
    handleHotkeyChange(hotkey);
  }
  hideHotkeyCaptureWindow();
});

ipcMain.on('cancel-hotkey', () => {
  hideHotkeyCaptureWindow();
});
// === END IPC Handlers ===

// === IPC Handlers for Context Menu (Registered ONCE) ===
ipcMain.on('menu-account', () => {
  console.log('Account clicked');
  hideContextMenu();
});

ipcMain.on('menu-hotkey', () => {
  hideContextMenu();
  showHotkeyCaptureWindow();
});

ipcMain.on('menu-exit', () => {
  console.log('[IPC Main] Received menu-exit event');
  hideContextMenu(); // Hide the menu visually first
  console.log('[IPC Main] Calling app.quit() for graceful shutdown...');
  app.quit();
});
// === END IPC Handlers ===

// Show the notification popup
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
  const posX = Math.floor(pillBounds.x + (pillBounds.width / 2) - (notificationSize[0] / 2));
  const posY = pillBounds.y - notificationSize[1] - 5;

  console.log(`Positioning notification at x=${posX}, y=${posY}`);
  notificationWindow.setPosition(posX, posY);

  const safeMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dynamicNotificationHtml = `
    <html>
    <head>
      <style>
        html, body {
          margin: 0;
          padding: 0;
          background-color: transparent;
          overflow: hidden;
        }
        
        body {
          margin: 0;
          padding: 0;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          overflow: hidden;
          user-select: none;
        }
        
        .container {
          background-color: rgba(44, 44, 44, 0.95);
          border: 1px solid rgba(80, 80, 80, 0.8);
          border-radius: 12px;
          padding: 4px;
          overflow: hidden;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
          opacity: 0;
          transition: opacity 0.3s ease-in-out;
        }
        
        .container.visible {
          opacity: 1;
        }
        
        .message {
          font-size: 13px;
          padding: 6px 10px;
          text-align: center;
          white-space: nowrap;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="message">${safeMessage}</div>
      </div>
    </body>
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
      }, 300); // Wait for fade out animation
    }
    notificationTimeout = null;
  }, durationMs);
};

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
