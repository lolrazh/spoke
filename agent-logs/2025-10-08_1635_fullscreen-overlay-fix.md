# Full-Screen Overlay Fix

**Date:** 2025-10-08  
**Agent:** Claude 3.7 Sonnet  
**Status:** ✅ Completed  

## User Intention
User wanted Sonic Flow's pill window to appear over full-screen applications (like Cursor AI) while maintaining all existing functionality: dock icon visibility, click-through behavior, hover detection, double-click to expand settings, and dictation state visibility. The existing `setAlwaysOnTop(true, "screen-saver")` configuration wasn't sufficient because macOS treats regular apps differently in full-screen Spaces.

## What We Accomplished
- ✅ **Full-screen overlay support** - Pill now appears over any full-screen app (Cursor, browsers, etc.)
- ✅ **Dock icon preservation** - App remains visible in dock and Cmd+Tab switcher
- ✅ **Panel window type** - Added macOS `type: 'panel'` for proper window behavior
- ✅ **Critical flags configuration** - Implemented `visibleOnFullScreen: true` and `skipTransformProcessType: true`
- ✅ **TypeScript type fix** - Fixed stdout type assertion error in notch reporter

## Technical Implementation
Implemented the three-part solution for macOS full-screen overlay:

1. **Window Type**: Set `type: 'panel'` in BrowserWindowConstructorOptions (line 1617)
2. **Workspace Visibility**: Enhanced `setVisibleOnAllWorkspaces()` with critical flags (lines 1665-1668):
   - `visibleOnFullScreen: true` - Allows window in full-screen Spaces
   - `skipTransformProcessType: true` - Prevents app from becoming UIElement/accessory, keeping dock icon
3. **Fullscreen Prevention**: Added `setFullScreenable(false)` to prevent pill from going fullscreen itself

**Files Modified:**
- `src/main.ts` (lines 1617, 1661-1670, 765) - Added panel type, enhanced workspace visibility with flags, fixed TypeScript error

## Bugs & Issues Encountered
1. **TypeScript error on line 765** - `Property 'toString' does not exist on type 'never'`
   - **Fix:** Added type assertion `(stdout as Buffer).toString("utf8")` to handle the union type properly in the notch reporter stdout handling

## Key Learnings
- **`skipTransformProcessType: true` is critical** - Without this flag, macOS converts the app into a UIElement/accessory process (no dock icon) when using `visibleOnFullScreen: true`
- **Panel window type matters** - Using `type: 'panel'` signals to macOS that this is a utility overlay window, not a regular document window
- **Full-screen overlay requires three pieces** - Window type + visibility flags + fullscreen prevention all work together
- **Click-through independence** - `setIgnoreMouseEvents()` behavior is completely independent of window level/type, so existing click-through logic continues working

## Architecture Decisions
- **Chose panel type over hiding dock** - Initial investigation suggested `app.dock.hide()` but user required dock icon visibility for app discoverability and Cmd+Tab access
- **Platform-specific conditional** - Applied panel type only on macOS since Windows/Linux have different window management paradigms
- **No changes to click-through logic** - Existing mouse event handling with `{ forward: true }` already supports hover detection even when click-through is enabled

## Ready for Next Session
- ✅ **Full-screen support complete** - Works across all full-screen apps and Mission Control spaces
- ✅ **All existing interactions preserved** - Click-through, hover, expand, tray menu, etc. all functional
- ✅ **Type safety maintained** - All TypeScript errors resolved

## Context for Future
This fix enables Sonic Flow to be truly omnipresent across all macOS Spaces and full-screen applications, which is essential for the "always available dictation" user experience. The solution follows the same pattern used by other successful overlay apps (AI Terminal, etc.) and maintains backward compatibility with all existing window behaviors. Future work on window management should preserve these three critical settings for macOS full-screen support.
