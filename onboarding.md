# Onboarding Migration Plan: From Pill to Dedicated Window

## 🎯 Objective
Migrate the existing onboarding functionality from the always-on-top pill window to a dedicated, frameless onboarding window. This improves the user experience by preventing the onboarding UI from blocking system permission dialogs.

## 📋 Current State Analysis

### Current Architecture
- **Single Window**: The main window (`mainWindow`) serves both the pill and onboarding
- **Onboarding Location**: `src/components/Onboarding.tsx` - shown inside the pill when `showOnboarding` is true
- **Window Properties**: Always on top, frameless, transparent, non-focusable
- **Routing**: React Router handles `/` (App) and `/onboarding` routes
- **State Management**: `showOnboarding` boolean in App.tsx controls visibility

### Current Onboarding Flow
1. **Permission Check**: Uses `window.electron.checkPermissions()` to check AX and IM permissions
2. **Accessibility Permission**: Calls `window.electron.requestAccessibilityPermission()`
3. **Input Monitoring Permission**: Calls `window.electron.requestInputMonitoringPermission()`
4. **Completion**: Calls `window.electron.startHelper()` and `window.electron.reloadApp()`

### Identified Issues
- **Missing IPC Handler**: `helper:start` is referenced but not implemented in main.ts
- **Always On Top**: Onboarding UI can cover system permission dialogs
- **Fixed Window**: Can't easily resize or reposition for better UX

## 🔄 Migration Strategy

### Phase 1: Create Dedicated Onboarding Window

**New Window Properties:**
```typescript
const onboardingWindowOptions = {
  width: 500,
  height: 600,
  frame: false,          // Frameless like pill, but...
  transparent: false,    // Solid background for readability
  backgroundColor: "#1f2937", // Dark gray background
  alwaysOnTop: false,    // ✅ KEY CHANGE: Won't block system dialogs
  focusable: true,       // ✅ Can receive focus and input
  resizable: false,
  skipTaskbar: true,
  show: false,
  center: true,          // Center on screen
  webPreferences: {
    // Same as main window
    contextIsolation: true,
    sandbox: false,
    nodeIntegration: false,
    preload: path.join(__dirname, "preload.js"),
  }
}
```

**Window Lifecycle:**
1. Create onboarding window only when needed
2. Load dedicated onboarding route (`#/onboarding`)
3. Destroy window when onboarding completes
4. Show pill window after onboarding destruction

### Phase 2: Update IPC Handlers

**Missing Handler Implementation:**
```typescript
// Add to main.ts
ipcMain.handle("helper:start", () => {
  console.log("[IPC] Starting helper process for onboarding completion");
  // This should start the Fn key listener
  startFnListener();
  return { success: true };
});
```

**New Handler for Window Management:**
```typescript
ipcMain.handle("onboarding-complete", () => {
  // Destroy onboarding window
  // Show pill window
  // Set first-run complete flag
});
```

### Phase 3: Component Migration

**Keep Existing Component**: `src/components/Onboarding.tsx` needs minimal changes
- Remove `h-screen` constraint for better sizing
- Update styling for dedicated window context
- Add completion callback to communicate with main process

**Update App.tsx Logic:**
```typescript
// Remove onboarding logic from App.tsx
// App.tsx will only handle the pill
// Onboarding happens in separate window
```

## 📁 File Changes Required

### 1. `src/main.ts`
- **Add**: `createOnboardingWindow()` function
- **Add**: `helper:start` IPC handler 
- **Add**: `onboarding-complete` IPC handler
- **Update**: Window management logic for two windows
- **Add**: First-run preference tracking

### 2. `src/components/App.tsx`
- **Remove**: `showOnboarding` state and logic
- **Remove**: Onboarding rendering
- **Simplify**: Always render pill (onboarding happens elsewhere)

### 3. `src/components/Onboarding.tsx`
- **Update**: Styling for dedicated window
- **Add**: Completion callback to main process
- **Remove**: Full-screen constraints

### 4. `src/preload.ts`
- **Add**: `onboardingComplete()` function
- **Ensure**: All existing onboarding IPC calls work

### 5. `src/renderer.tsx`
- **Minimal changes**: Routing should work as-is
- **Consider**: Separate renderer entry point for onboarding

### 6. New: `src/constants/onboarding.ts`
```typescript
export const ONBOARDING_WIDTH = 500;
export const ONBOARDING_HEIGHT = 600;
export const FIRST_RUN_PREF_KEY = "firstRunComplete";
```

## 🔧 Implementation Steps

### Step 1: Create Window Management Functions
```typescript
// In main.ts
let onboardingWindow: BrowserWindow | null = null;

function createOnboardingWindow() {
  // Create dedicated onboarding window
  // Load #/onboarding route
  // Return promise that resolves when window is ready
}

function destroyOnboardingWindow() {
  // Clean up onboarding window
  // Show main pill window
}
```

### Step 2: Add Missing IPC Handlers
```typescript
ipcMain.handle("helper:start", () => {
  startFnListener();
  return { success: true };
});

ipcMain.handle("onboarding-complete", async () => {
  // Set first-run preference
  // Destroy onboarding window  
  // Show pill window
  return { success: true };
});
```

### Step 3: Update Onboarding Component
- Modify `handleStartApp` to call new completion handler
- Adjust styling for dedicated window context

### Step 4: Update App Launch Logic
```typescript
// In app.whenReady()
const needsOnboarding = await checkIfFirstRun();
if (needsOnboarding) {
  createOnboardingWindow();
} else {
  createWindow(); // Create pill window
}
```

## 🧪 Testing Strategy

### Test Cases
1. **First Launch**: Should show onboarding window, not pill
2. **Permission Dialogs**: Should not be blocked by onboarding window
3. **Completion Flow**: Should transition from onboarding → pill smoothly
4. **Subsequent Launches**: Should skip onboarding, show pill directly
5. **Window Focus**: Onboarding should be focusable, pill should not

### Testing Steps
1. Delete app preferences to simulate first run
2. Launch app - verify onboarding window appears
3. Test permission flows - verify system dialogs are not blocked
4. Complete onboarding - verify pill appears
5. Restart app - verify onboarding is skipped

## 🚀 Benefits After Migration

1. **Better UX**: Permission dialogs won't be blocked
2. **Cleaner Architecture**: Separation of concerns
3. **Future-Proof**: Easy to add more onboarding steps
4. **Better Layout**: More space for onboarding content
5. **Professional Feel**: Matches other Mac apps' patterns

## 🔗 Dependencies

- All existing IPC handlers must remain functional
- React Router routes must continue working
- Existing component props/state should be preserved
- No changes to permission checking logic needed

## 📝 ELI5 Summary

**Current Problem:** 
Imagine you have a sticky note (the pill) that's always on top of everything. When you try to show a welcome message on this sticky note, it covers up important system popup windows that ask for permissions.

**The Solution:**
Instead of showing the welcome message on the sticky note, we create a separate welcome window that appears first. This welcome window can move behind system popups when needed. Once you finish the welcome process, the welcome window disappears and the sticky note appears.

**Key Changes:**
1. Create a new welcome window (onboarding window)
2. Make it appear first when the app starts
3. Make it go away when setup is complete  
4. Show the sticky note (pill) only after welcome is done
5. Fix a missing piece of code that starts the keyboard listener

This way, system permission dialogs won't be hidden, and the user experience will be much better! 