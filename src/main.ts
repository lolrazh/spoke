import { app, BrowserWindow, Tray, globalShortcut, nativeImage, screen, ipcMain, dialog, clipboard, shell } from 'electron';
import path from 'node:path';
import process from 'node:process';
import started from 'electron-squirrel-startup';
import { loadSettings, updateSetting } from './lib/settings';
import fs from 'node:fs';
import { execSync } from 'child_process';
import { session } from 'electron';

// Add command line switches for WebGPU - KEEP THESE
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let currentHotkey = '';
let hotkeyDialogOpen = false;
let captureWindow: BrowserWindow | null = null;
let contextMenuWindow: BrowserWindow | null = null;
let contextMenuOpen = false;
let notificationWindow: BrowserWindow | null = null;
let notificationTimeout: NodeJS.Timeout | null = null;
let isQuitting = false;
let homeWindow: BrowserWindow | null = null;

// Determine the path to the icon file (works in both packaged and dev environments)
const iconPath = path.join(__dirname, 'assets', 'icon.ico');

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
      contextIsolation: true,
      sandbox: false,
      enableWebSQL: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.mjs'),
      additionalArguments: ['--enable-features=SharedArrayBuffer'],
    },
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
  });

  // Also set the icon explicitly after creation (optional but good practice)
  mainWindow.setIcon(iconPath);

  // Show window inactive only when it's ready to prevent focus stealing
  mainWindow.once('ready-to-show', () => {
    mainWindow.showInactive();
    console.log('Main window shown inactive.');
    // Automatically open DevTools for debugging
    mainWindow.webContents.openDevTools({ mode: 'detach' }); 
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

  // Register global shortcut from settings
  registerGlobalShortcut();

  // Pre-create the hotkey capture window for better performance
  createHotkeyCaptureWindow();

  // Add this handler to grant permissions needed for SharedArrayBuffer in some contexts
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    // In a real app, you might want to be more specific about which permissions
    // and origins you grant, but for local development/SAB, granting broadly is common.
    console.log(`Granting permission: ${permission} to ${webContents.getURL()}`);
    callback(true);
  });
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
          <button id="homeBtn" class="menu-item">Home</button>
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
          document.getElementById('homeBtn').addEventListener('click', () => {
            window.contextMenuAPI.send('menu-home');
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
  // Check if context menu is already open or doesn't exist
  if (contextMenuOpen || !contextMenuWindow) return;
  
  contextMenuOpen = true;
  const menuSize = contextMenuWindow.getSize();
  const menuWidth = menuSize[0];
  const menuHeight = menuSize[1];
  
  let positionX: number;
  let positionY: number;
  
  // If anchor coordinates are provided (e.g., from tray click), position relative to them
  if (anchorX !== undefined && anchorY !== undefined) {
    console.log(`[showContextMenu] Positioning relative to anchor: x=${anchorX}, y=${anchorY}`);
    // Calculate top-left position to align the menu's bottom-right corner with the anchor point
    positionX = anchorX - menuWidth;
    positionY = anchorY - menuHeight;
    
    // Optional Fine-Tuning (keep for tray)
    const fineTuneX = 0; 
    const fineTuneY = 0; 
    positionX += fineTuneX;
    positionY += fineTuneY;
    console.log(`[showContextMenu] Calculated top-left for anchor: x=${positionX}, y=${positionY}`);
  } 
  // If anchor coordinates are NOT provided (e.g., from pill click), position above the pill
  else if (mainWindow) { // Ensure mainWindow exists for pill bounds
    console.log('[showContextMenu] Positioning relative to pill');
    const pillBounds = mainWindow.getBounds();
    // Get size again just before calculation
    const currentMenuSize = contextMenuWindow.getSize(); 
    const currentMenuHeight = currentMenuSize[1];
    const currentMenuWidth = currentMenuSize[0];

    // Center the menu horizontally above the pill
    positionX = Math.floor(pillBounds.x + (pillBounds.width / 2) - (currentMenuWidth / 2));
    // Align bottom with pill top (gap=0), then add offset to move down
    const calculatedPosY = pillBounds.y - currentMenuHeight;
    const downwardOffset = 40; // Move down by 40px
    positionY = calculatedPosY + downwardOffset; 
    
    // Log the values used for calculation
    console.log(`[showContextMenu Debug] pillBounds.y=${pillBounds.y}, currentMenuHeight=${currentMenuHeight}, offset=${downwardOffset}, calculated posY=${positionY}`);

    console.log(`[showContextMenu] Calculated top-left for pill: x=${positionX}, y=${positionY}`);
  } 
  // Fallback if no anchor and no mainWindow (shouldn't happen for pill click)
  else {
    console.error('[showContextMenu] Cannot position: No anchor coordinates and mainWindow is not available.');
    contextMenuOpen = false; // Reset flag
    return; 
  }
  
  // Set the calculated position
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
ipcMain.handle('insert-text-at-cursor', async (_event: Electron.IpcMainInvokeEvent, text: string) => {
  let originalClipboardText: string | undefined = undefined;
  try {
    console.log('=== TEXT INSERTION PROCESS START ===');
    console.log('Received text:', text);

    // Read and store the current clipboard content (text only)
    // const { clipboard } = require('electron'); // Removed require
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
    const wasElectronWindowFocused = !!activeWindow; // Track if an electron window was initially focused

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
        // const { execSync } = require('child_process'); // Removed require
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // Set disk cache options to avoid cache errors
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-http-cache');
  
  createWindow();
  createTray();
  createContextMenuWindow();
  createHomeWindow();
  createNotificationWindow();

  // Set up IPC handler for showing the custom context menu (from pill click)
  ipcMain.on('show-context-menu', (event: Electron.IpcMainEvent) => {
    console.log(`[IPC Main] Received show-context-menu event from pill.`);
    // Call showContextMenu WITHOUT coordinates to trigger pill positioning logic
    showContextMenu(); 
  });

  // Set up IPC handler for showing notifications requested by the renderer
  ipcMain.on('show-notification', (event: Electron.IpcMainEvent, message: string) => {
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
    
  } catch (error) {
    // Use original console for errors during cleanup
    console.error('[App Event] will-quit: Error during cleanup:', error);
    // Ensure console is restored even if error occurred before restoreConsole() call
    // restoreConsole(); 
    // Attempt to end stream again if it exists and error happened before ending
    // if (logStream && !logStream.writableEnded) { ... }
  }
});

// === IPC Handlers for Hotkey Window (Registered ONCE) ===
ipcMain.on('save-hotkey', (_event: Electron.IpcMainEvent, hotkey: string) => {
  if (isValidHotkeyFormat(hotkey)) {
    handleHotkeyChange(hotkey);
  }
  hideHotkeyCaptureWindow();
});

ipcMain.on('cancel-hotkey', (_event: Electron.IpcMainEvent) => {
  hideHotkeyCaptureWindow();
});
// === END IPC Handlers ===

// === IPC Handlers for Context Menu (Registered ONCE) ===
ipcMain.on('menu-home', (_event: Electron.IpcMainEvent) => {
  console.log('[IPC Main] \'menu-home\' received.');
  console.log('[IPC Main] Current state of homeWindow before check: ' + (homeWindow ? 'Exists' : 'null'));
  if (homeWindow) {
    console.log('[IPC Main] Home window exists, focusing...');
    homeWindow.focus();
  } else {
    console.log('[IPC Main] Home window is null, creating new window...');
    createHomeWindow();
  }
  hideContextMenu();
});

ipcMain.on('menu-hotkey', (_event: Electron.IpcMainEvent) => {
  hideContextMenu();
  showHotkeyCaptureWindow();
});

ipcMain.on('menu-exit', (_event: Electron.IpcMainEvent) => {
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
  const notificationHeight = notificationSize[1];
  const posX = Math.floor(pillBounds.x + (pillBounds.width / 2) - (notificationSize[0] / 2));
  // Revert to gap-based logic, but use a negative gap to position slightly below pill top
  const gap = -5; // Negative gap moves it down
  const posY = pillBounds.y - notificationHeight - gap; 

  console.log(`Positioning notification at x=${posX}, y=${posY} (using gap=${gap})`);
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

// Add the new function for the Home window
const createHomeWindow = () => {
  if (homeWindow) {
    homeWindow.focus();
    return;
  }

  // Reduce width by 10%, height by 20% from 1100x700
  const newWidth = 920; 
  const newHeight = 470;

  homeWindow = new BrowserWindow({
    width: newWidth,
    height: newHeight,
    minWidth: newWidth,  // Set minimum width
    minHeight: newHeight, // Set minimum height
    show: false, // Don't show immediately, wait for ready-to-show
    title: 'Sonic Flow Home',
    webPreferences: {
      // Consider creating a dedicated preload script for the home window later
      // preload: path.join(__dirname, 'home-preload.js'), 
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      enableWebSQL: false,
    },
    icon: iconPath, // Reuse the same icon
  });

  // Load the React-based home route (dev vs. production)
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    homeWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/home`);
  } else {
    const indexHtml = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    homeWindow.loadURL(`file://${indexHtml}#/home`);
  }

  // Optional: Remove menu bar
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
