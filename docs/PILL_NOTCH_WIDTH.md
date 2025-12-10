# Pill Notch Width Detection & Persistence

A system for detecting MacBook notch dimensions once on first launch and persisting the optimal pill width for instant startup on all subsequent launches.

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Detection Pipeline](#detection-pipeline)
4. [Storage & Persistence](#storage--persistence)
5. [IPC Communication](#ipc-communication)
6. [Optical Adjustment](#optical-adjustment)
7. [User Flows](#user-flows)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### Problem Statement
The floating pill needs to match the width of the MacBook's notch for visual cohesion. However, detecting notch dimensions requires native system calls, and users with multi-monitor setups (MacBook + external display) would see the wrong width on startup if the app opened on the external monitor.

### Solution
Detect the built-in display's notch width **once** on first launch and store it in user preferences. All subsequent launches use the stored value instantly, regardless of which display the app starts on.

### Key Benefits
- ✅ **Instant startup**: No detection overhead after first launch
- ✅ **Multi-monitor support**: Correct width regardless of startup display
- ✅ **Optical tuning**: -2px adjustment for better visual alignment
- ✅ **Hardware-based**: Width is a constant tied to the device, not the current display configuration

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process (Node.js)                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐      ┌──────────────────┐             │
│  │ notch-reporter  │─────▶│ detectAndStore   │             │
│  │  (Swift binary) │      │  NotchWidth()    │             │
│  └─────────────────┘      └────────┬─────────┘             │
│                                     │                        │
│                                     ▼                        │
│  ┌──────────────────────────────────────────────┐          │
│  │      pill-preferences.json                   │          │
│  │      { "notchWidth": 207 }                   │          │
│  └──────────────────────────────────────────────┘          │
│                                     │                        │
│                                     ▼                        │
│  ┌──────────────────────────────────────────────┐          │
│  │  emitActiveDisplayInfo()                     │          │
│  │  - Reads pillPreferences.notchWidth          │          │
│  │  - Sends storedNotchWidth via IPC            │          │
│  └──────────────────────────────────────────────┘          │
│                       │                                      │
└───────────────────────┼──────────────────────────────────────┘
                        │ IPC: active-display
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  Renderer Process (React)                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  window.onActiveDisplay((payload) => {                      │
│    const notchWidth = payload.storedNotchWidth;             │
│    setNotchWidth(notchWidth); // 207px                      │
│  })                                                          │
│                                                               │
│  // Pill renders with correct width immediately             │
│  const BASE_W = notchWidth ?? TOKENS.PILL_BASE_W;           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### File Locations

**Main Process:**
- `src/main.ts` - Detection, storage, IPC emission
- `src/types/shared.ts` - Type definitions

**Renderer Process:**
- `src/components/App.tsx` - Width consumption
- `src/config/uiTokens.ts` - Fallback width token

**Native Binary:**
- `native/notch-reporter.swift` - Swift source
- `native/bin/notch-reporter` - Compiled binary

**Storage:**
- `~/Library/Application Support/spoke-app/pill-preferences.json`

---

## Detection Pipeline

### Step 1: Swift Binary Execution

The `notch-reporter` Swift binary queries macOS for all connected displays:

```swift
let screens = NSScreen.screens

for screen in screens {
  let displayId = CGDisplayIsBuiltin(displayId)
  let isBuiltin = CGDisplayIsBuiltin(displayId) != 0
  
  var leftRect: RectData? = nil
  var rightRect: RectData? = nil
  var notchWidth = 0.0
  
  if #available(macOS 12.0, *) {
    if let left = screen.auxiliaryTopLeftArea,
       let right = screen.auxiliaryTopRightArea,
       !left.isEmpty,
       !right.isEmpty {
      // Notch width = total width - left area - right area
      notchWidth = Double(frame.width - left.width - right.width)
    }
  }
}
```

**Output (JSON):**
```json
{
  "timestamp": 1696595847.123,
  "screens": [
    {
      "id": 1,
      "isBuiltIn": true,
      "hasNotch": true,
      "notchWidth": 209.0,
      "auxiliaryLeft": { "x": 0, "y": 0, "width": 750.5, "height": 53 },
      "auxiliaryRight": { "x": 959.5, "y": 0, "width": 750.5, "height": 53 },
      "scaleFactor": 2.0
    },
    {
      "id": 2,
      "isBuiltIn": false,
      "hasNotch": false,
      "notchWidth": 0.0
    }
  ]
}
```

### Step 2: Main Process Detection

`detectAndStoreNotchWidth()` in `src/main.ts`:

```typescript
async function detectAndStoreNotchWidth(): Promise<number | null> {
  console.log("[PillPrefs] Detecting notch width for the first time...");
  
  // 1. Execute notch-reporter binary
  await refreshNotchInfo("initial-detection");
  
  if (!notchReport || !notchReport.screens || notchReport.screens.length === 0) {
    console.log("[PillPrefs] No notch report available");
    return null;
  }
  
  // 2. Find the built-in display with a notch
  const builtInWithNotch = notchReport.screens.find(
    (screen) => screen.isBuiltIn && screen.hasNotch && screen.notchWidth > 0
  );
  
  if (!builtInWithNotch) {
    console.log("[PillPrefs] No built-in display with notch found");
    return null;
  }
  
  // 3. Apply optical adjustment (-2px)
  const detectedWidth = builtInWithNotch.notchWidth;
  const adjustedWidth = detectedWidth - 2;
  console.log(`[PillPrefs] Detected notch width: ${detectedWidth.toFixed(2)}px, storing adjusted: ${adjustedWidth.toFixed(2)}px on display ${builtInWithNotch.id}`);
  
  // 4. Store the adjusted width
  pillPreferences.notchWidth = adjustedWidth;
  savePillPreferences(pillPreferences);
  
  return adjustedWidth;
}
```

### Step 3: Sanitization & Validation

Input from Swift binary is sanitized to handle unexpected data:

```typescript
function sanitizeScreen(raw: NotchRawScreen, timestamp: number): DisplayNotchInfo | null {
  if (!raw || typeof raw !== "object") return null;
  
  const id = Math.trunc(toNumber(raw.id, -1));
  if (id < 0) return null;

  const frame = sanitizeRect(raw.frame);
  const visibleFrame = sanitizeRect(raw.visibleFrame);
  if (!frame || !visibleFrame) return null;

  const safeAreaInsets = sanitizeEdgeInsets(raw.safeAreaInsets);
  const auxiliaryLeft = sanitizeRect(raw.auxiliaryLeft ?? null);
  const auxiliaryRight = sanitizeRect(raw.auxiliaryRight ?? null);

  return {
    id,
    isBuiltIn: Boolean(raw.isBuiltIn),
    hasNotch: Boolean(raw.hasNotch),
    notchWidth: toNumber(raw.notchWidth, 0),
    // ... other fields
  };
}
```

---

## Storage & Persistence

### Preferences Structure

**File:** `~/Library/Application Support/spoke-app/pill-preferences.json`

**Format:**
```json
{
  "notchWidth": 207
}
```

### Load/Save Functions

```typescript
// Global state
let pillPreferences: PillPreferences = {};
let pillPrefsPath: string;

// Load on app startup
function loadPillPreferences(): PillPreferences {
  try {
    if (fs.existsSync(pillPrefsPath)) {
      const data = fs.readFileSync(pillPrefsPath, "utf8");
      const prefs = JSON.parse(data);
      console.log("[PillPrefs] Loaded preferences:", prefs);
      return prefs;
    }
  } catch (error) {
    console.error("[PillPrefs] Failed to load preferences:", error);
  }

  console.log("[PillPrefs] No stored preferences found");
  return {};
}

// Save after detection
function savePillPreferences(prefs: PillPreferences): void {
  try {
    const userDataDir = app.getPath("userData");
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    fs.writeFileSync(pillPrefsPath, JSON.stringify(prefs, null, 2));
    console.log("[PillPrefs] Saved preferences:", prefs);
  } catch (error) {
    console.error("[PillPrefs] Failed to save preferences:", error);
  }
}
```

### Initialization

In `app.whenReady()`:

```typescript
// Initialize path
pillPrefsPath = path.join(app.getPath("userData"), "pill-preferences.json");

// Load preferences
pillPreferences = loadPillPreferences();

// Later, check if detection is needed
if (!pillPreferences.notchWidth) {
  detectAndStoreNotchWidth().then((width) => {
    if (width && mainWindow && !mainWindow.isDestroyed()) {
      const display = getDisplayForWindow();
      const scale = computeScaleForDisplay(display);
      emitActiveDisplayInfo(display, scale);
    }
  });
}
```

---

## IPC Communication

### Type Definitions

**`src/types/shared.ts`:**

```typescript
export type PillPreferences = { 
  notchWidth?: number 
};

export type ActiveDisplayPayload = {
  id: number;
  bounds: Rect;
  size: Size;
  workArea: Rect;
  scaleFactor: number;
  scale: number;
  window: Rect | null;
  notch?: DisplayNotchInfo | null;        // Per-display dynamic info
  storedNotchWidth?: number | null;       // Stored static width
};
```

### Main Process: Emit

```typescript
function emitActiveDisplayInfo(display: Electron.Display, scale: number): void {
  try {
    const notch = getNotchInfoForDisplay(display.id);
    const notchPayload = notch ? cloneDisplayNotchInfo(notch) : null;
    
    // Include stored notch width if available
    const storedNotchWidth = pillPreferences.notchWidth ?? null;
    
    const payload: ActiveDisplayPayload = {
      id: display.id,
      bounds: display.bounds,
      size: display.size,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      scale,
      window: mainWindow?.getBounds() ?? null,
      notch: notchPayload,
      storedNotchWidth,  // ← Static, always available
    };
    
    mainWindow?.webContents.send("active-display", payload);
  } catch (e) {
    logger.main.warn("emitActiveDisplayInfo failed", e);
  }
}
```

### Renderer Process: Receive

**`src/components/App.tsx`:**

```typescript
// State for notch width
const [notchWidth, setNotchWidth] = useState<number | null>(null);

// Listen for active display updates
useEffect(() => {
  if (typeof window.onActiveDisplay !== "function") return;
  
  window.onActiveDisplay?.((payload) => {
    const s = typeof payload?.scale === "number" ? payload.scale : 1;
    setUiScale(s);
    
    // Use stored notch width (calculated once on first launch)
    const storedWidth = payload?.storedNotchWidth;
    const nextNotchWidth = 
      storedWidth && storedWidth > 0 ? storedWidth : null;
    setNotchWidth(nextNotchWidth);
    
    const source = storedWidth ? "stored-preference" : "fallback";
    console.log(
      `[Display] active=${payload?.id ?? "?"} scale=${s.toFixed(3)} notch=${nextNotchWidth?.toFixed(2) ?? "none"} source=${source}`,
    );
  });
}, []);

// Use the notch width
const notchTarget = notchWidth && notchWidth > 0 ? notchWidth : null;
const baseWidthTarget = notchTarget ?? TOKENS.PILL_BASE_W;  // Fallback to 196
const BASE_W = Math.round(baseWidthTarget * baseWidthScale);
```

### Timing Critical: renderer-ready

**Problem:** IPC messages sent during window creation arrive before the renderer sets up listeners.

**Solution:** Re-emit display info when renderer signals ready:

```typescript
ipcMain.on("renderer-ready", (event) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin === mainWindow) {
    // ... window positioning ...
    
    // Re-emit active display info now that renderer is ready
    try {
      const current = mainWindow.getBounds();
      const display = screen.getDisplayMatching(current);
      const scale = computeScaleForDisplay(display);
      emitActiveDisplayInfo(display, scale);  // ← Ensures renderer receives it
    } catch (e) {
      console.warn("[renderer-ready] Failed to emit display info:", e);
    }
    
    // ... show window ...
  }
});
```

---

## Optical Adjustment

### Rationale

The exact notch width reported by macOS (209px on 16" MBP) doesn't produce the best visual alignment. The pill looks slightly too wide and loses the flush appearance with the notch edges.

### Implementation

A **-2px adjustment** is applied during detection:

```typescript
const detectedWidth = builtInWithNotch.notchWidth;  // 209px
const adjustedWidth = detectedWidth - 2;            // 207px
pillPreferences.notchWidth = adjustedWidth;
```

### Model-Specific Results

| MacBook Model | Detected Width | Adjusted Width | Visual Result |
|---------------|----------------|----------------|---------------|
| 14" MBP       | ~198px         | 196px          | Perfect flush alignment |
| 16" MBP       | 209px          | 207px          | Perfect flush alignment |

### Future Considerations

If Apple releases new MacBook models with different notch dimensions, the -2px adjustment may need to be model-specific. Current implementation applies the same adjustment universally, which has proven effective across current models.

---

## User Flows

### New User (Onboarding)

```
1. App launches → onboarding starts
2. User completes onboarding
3. onboarding-complete IPC handler runs:
   - Check if pillPreferences.notchWidth exists
   - If not: call detectAndStoreNotchWidth()
   - Detection runs asynchronously (~1-2s)
4. Main window appears with pill
   - Initial render: Uses fallback width (196px)
   - After detection: Re-emits with stored width (207px)
   - Pill updates to correct width
5. Subsequent launches: Instant correct width
```

**UX Impact:** Detection delay happens while onboarding window is still visible, so user never sees the pill at fallback width. Perceived as instant.

### Existing User (First Launch After Update)

```
1. App launches → skips onboarding
2. createWindow() runs:
   - Check if pillPreferences.notchWidth exists
   - If not: call detectAndStoreNotchWidth()
   - Detection runs asynchronously (~1-2s)
3. Main window appears:
   - Initial render: Uses fallback width (196px)
   - After detection: Re-emits with stored width (207px)
   - Pill updates to correct width
4. Subsequent launches: Instant correct width
```

**UX Impact:** User sees ~1-2s delay once on first launch after update. Acceptable trade-off for instant subsequent launches.

### Subsequent Launches (Steady State)

```
1. App launches
2. loadPillPreferences() runs immediately:
   - Reads pillPreferences.notchWidth from disk (207px)
3. createWindow() runs:
   - emitActiveDisplayInfo() includes storedNotchWidth: 207
4. Renderer receives payload:
   - Sets notchWidth state to 207
   - Pill renders with correct width immediately
5. No detection, no delay
```

**UX Impact:** Instant correct width, regardless of which display app starts on.

---

## Troubleshooting

### Pill Shows Wrong Width After Update

**Symptom:** Pill appears with fallback width (196px) instead of stored width (207px).

**Diagnosis:**
1. Check if preferences file exists:
   ```bash
   cat ~/Library/Application\ Support/spoke-app/pill-preferences.json
   ```

2. Check console logs for:
   ```
   [PillPrefs] Loaded preferences: { notchWidth: 207 }
   [Display] active=1 scale=0.990 notch=207.00 source=stored-preference
   ```

**Fixes:**
- **Missing file:** Delete and restart app to trigger re-detection
- **Wrong value:** Delete file and restart
- **IPC not received:** Check for `renderer-ready` re-emit (timing issue)

### Detection Fails on First Launch

**Symptom:** Logs show `[PillPrefs] No built-in display with notch found`.

**Diagnosis:**
1. Check if notch-reporter binary exists:
   ```bash
   ls -la native/bin/notch-reporter
   ```

2. Run binary manually:
   ```bash
   ./native/bin/notch-reporter
   ```

3. Check output for `"hasNotch": true` on built-in display

**Fixes:**
- **Binary missing:** Run `npm run postinstall` to rebuild
- **No notch detected:** Device may not have a notch (pre-2021 MacBook)
- **Swift error:** Check macOS version compatibility (requires macOS 12.0+)

### Width Changes After macOS Update

**Symptom:** Stored width no longer matches notch after OS update.

**Fix:**
```bash
rm ~/Library/Application\ Support/spoke-app/pill-preferences.json
```
Restart app to re-detect.

### Development vs Production Behavior

**Symptom:** Works in dev but not in production build.

**Diagnosis:**
- Dev: Binary at `native/bin/notch-reporter`
- Prod: Binary at `Contents/Resources/notch-reporter`

Check `getNotchReporterPath()` logic in `src/main.ts`:
```typescript
const reporterPath = app.isPackaged
  ? path.join(process.resourcesPath, "notch-reporter")
  : path.join(app.getAppPath(), "native", "bin", "notch-reporter");
```

**Fix:** Ensure `forge.config.ts` includes notch-reporter in packaged resources.

---

## Future Enhancements

### Model-Specific Adjustments

Currently applies -2px universally. Could be refined:

```typescript
const MODEL_ADJUSTMENTS: Record<number, number> = {
  198: -2,  // 14" MBP → 196
  209: -2,  // 16" MBP → 207
  // Future models...
};

const adjustment = MODEL_ADJUSTMENTS[detectedWidth] ?? -2;
const adjustedWidth = detectedWidth + adjustment;
```

### User Override

Allow users to manually adjust pill width in settings:

```typescript
export type PillPreferences = { 
  notchWidth?: number;
  userOverride?: number;  // Takes precedence over detected width
};
```

### Runtime Re-Detection

Add IPC handler for manual re-detection (e.g., after display replacement):

```typescript
ipcMain.handle("pill:recalculate-notch-width", async () => {
  const width = await detectAndStoreNotchWidth();
  return { ok: true, width };
});
```

---

## Related Documentation

- **DESIGN.md** - Pill visual design and tokens
- **TRANSCRIPTION.md** - Audio pipeline and state machine
- **AUTH.md** - Authentication and user session handling

---

**Last Updated:** 2025-10-06  
**Status:** ✅ Production Ready
