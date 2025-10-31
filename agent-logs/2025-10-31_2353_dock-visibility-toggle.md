# Dock Visibility Toggle Feature

**Date:** 2025-10-31
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention
User wanted to add a settings toggle that controls whether the Sonic Flow app icon appears in the macOS Dock, similar to how the "Show Floating Bar" setting works. The goal was to allow users to run the app as a pure menubar/tray app without dock presence, while maintaining accessibility through the existing tray icon. The setting should persist across app restarts.

## What We Accomplished
- ✅ **Full dock visibility toggle** - Implemented complete feature with UI, persistence, and IPC communication
- ✅ **Persistent preferences** - Created new app-level preferences storage system separate from pill-specific settings
- ✅ **Settings UI integration** - Added toggle in SettingsPanel with dock.rectangle SF Symbol icon
- ✅ **Blur event handling fix** - Resolved UX issue where dock operations caused unwanted settings panel collapse
- ✅ **Cross-platform safety** - Added platform checks to gracefully handle non-macOS environments

## Technical Implementation
Followed the exact architectural pattern established by the "Show Floating Bar" setting for consistency:

**Storage Architecture:**
- Created `AppPreferences` type in `shared.ts` for app-level settings
- Implemented `loadAppPreferences()` and `saveAppPreferences()` functions
- Preferences stored in `userData/app-preferences.json` (separate from pill-specific prefs)
- Default value: `showInDock: true` (safe default for first launch)

**IPC Communication:**
- `dock:get-visible` - Returns current dock visibility state from preferences
- `dock:set-visible` - Applies dock visibility change and persists preference
- Both handlers include macOS platform checks (`process.platform === 'darwin'`)

**Startup Behavior:**
- Preferences loaded during `app.whenReady()`
- Dock visibility applied immediately based on saved preference
- Runs before window creation to ensure correct state from launch

**UI Implementation:**
- Toggle placed after "Show Floating Bar" in Defaults section
- Label: "Show in Dock"
- Description: "Display app icon in the macOS Dock"
- Icon: `dock.rectangle` SF Symbol (already in assets)
- State initialized from main process via `getDockVisible()` IPC call
- Settings panel height increased from 440px to 510px to fit new toggle without overflow

**Files Modified:**
- `src/types/shared.ts` - Added `AppPreferences` type
- `src/main.ts` - Added preferences storage, IPC handlers, startup logic, blur fix
- `src/types/electron.d.ts` - Added TypeScript declarations for dock methods
- `src/preload.ts` - Exposed dock visibility methods via contextBridge
- `src/components/SettingsPanel.tsx` - Added UI toggle with state management
- `src/constants/window.ts` - Increased settings panel height from 440 to 510 to accommodate new toggle

## Bugs & Issues Encountered
1. **Settings panel collapsed when toggling dock visibility** - After implementing the feature, toggling the switch caused the settings panel to immediately collapse, making it impossible to interact with other settings
   - **Root Cause:** `app.dock.show()` and `app.dock.hide()` cause the main window to lose focus (blur event). The existing blur handler automatically sent a "collapse-request" to close expanded settings
   - **Fix:** Added `dockOperationInProgress` flag that temporarily prevents blur-triggered collapse during dock operations. Flag is set before dock operation and cleared after 300ms delay to allow focus to settle
   - **Code Pattern:**
     ```typescript
     dockOperationInProgress = true;
     await app.dock.show(); // or hide()
     setTimeout(() => { dockOperationInProgress = false; }, 300);
     ```

2. **Dock icon not actually hiding after blur fix** - Initial fix implementation prevented collapse but broke the actual dock visibility change
   - **Root Cause:** `app.dock.show()` returns a Promise that wasn't being awaited, causing timing issues
   - **Fix:** Changed IPC handler to `async` and added `await` to `app.dock.show()` call

## Key Learnings
- **macOS dock operations trigger blur events** - Calling `app.dock.show()` or `app.dock.hide()` causes the active window to lose focus, which can interfere with UX flows that rely on blur detection
- **app.dock.show() is async** - Unlike `app.dock.hide()` which is synchronous, `app.dock.show()` returns a Promise and must be awaited for reliable behavior
- **Blur-based collapse detection needs guards** - Any main process operation that causes focus shifts requires guarding the blur handler to prevent unintended UI state changes
- **Separate concerns in preferences** - App-level settings (dock, window state) should be separate from feature-specific preferences (pill dimensions, mic selection) for cleaner architecture

## Architecture Decisions
- **Separate app preferences file** - Created dedicated `app-preferences.json` instead of adding to `pill-preferences.json` to maintain separation of concerns and allow for future app-level settings
- **Follow existing patterns** - Deliberately mirrored the "Show Floating Bar" implementation for consistency, making the codebase easier to understand and maintain
- **Default to visible** - Chose `showInDock: true` as the default to ensure safe first-run experience; users can opt into menubar-only mode
- **300ms blur guard timeout** - Empirically chosen delay that allows macOS focus handling to settle without being too long for users to notice in edge cases

## Ready for Next Session
- ✅ **Dock visibility feature** - Fully functional with persistence, ready for production
- ✅ **App preferences infrastructure** - Reusable pattern established for future app-level settings
- ✅ **SF Symbol integration** - dock.rectangle icon already in assets and working
- 🔧 **Pre-existing TypeScript errors** - Unrelated TS errors exist in the codebase (SettingsCard.tsx, useTranscription.ts, etc.) but don't affect functionality

## Context for Future
The dock visibility toggle establishes a clean pattern for future app-level UI preferences. The blur guard mechanism (`dockOperationInProgress`) demonstrates how to handle macOS focus quirks during system-level operations. This feature enables users to run Sonic Flow as a pure menubar app, which is a common request for utility apps. Future enhancements could include: additional appearance settings (launch at login, show in menubar style), window position memory, or keyboard shortcut customization—all of which would fit naturally into the `AppPreferences` infrastructure now in place.
