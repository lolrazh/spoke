# Hotkey Cancel Buffer Fix

**Date:** 2025-11-24
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention
User experienced a frustrating UX issue where after canceling dictation in hands-free mode (double-tap hotkey), immediately double-tapping again to restart didn't work. They described it as feeling like there's a "buffer time" preventing immediate re-activation. The underlying goal was to fix this responsiveness issue so users can seamlessly restart dictation without delay after canceling.

## What We Accomplished
- ✅ **Fixed double-tap state cleanup in cancel handler** - Added proper cleanup of `doubleTapTimerRef` and `lastTapUpRef` when user cancels dictation, enabling immediate re-activation
- ✅ **Identified root cause through codebase exploration** - Discovered that the cancel handler was only cleaning up `pressTimerRef` but not the double-tap detection state
- ✅ **Committed and pushed fix** - Changes deployed to branch `claude/fix-hotkey-after-cancel-01RGfmVMVRCkMZNv6agbNwJY`

## Technical Implementation
The hotkey system uses a native C helper (`sonic-helper`) that sends IPC messages for Right Option key events. Double-tap detection is handled in React with:
- **450ms detection window** tracked by `doubleTapTimerRef`
- **Last tap timestamp** stored in `lastTapUpRef`
- **Right Command** triggers cancel via `ptt-cancel` IPC message

The bug was in the cancel handler (`App.tsx:1048-1079`) which cleared `pressTimerRef` but left double-tap state dirty, preventing the next gesture from being recognized.

**Fix added:**
```typescript
// Clear double-tap detection state to allow immediate re-activation
if (doubleTapTimerRef.current) {
  clearTimeout(doubleTapTimerRef.current);
  doubleTapTimerRef.current = null;
}
lastTapUpRef.current = null;
```

**Files Modified:**
- `src/components/App.tsx` (lines 1056-1061) - Added double-tap state cleanup in cancel handler

## Bugs & Issues Encountered
1. **Double-tap not working after cancel** - After canceling hands-free mode and immediately double-tapping again, the hotkey was unresponsive
   - **Root Cause:** Cancel handler (`onCancel`) was only cleaning up `pressTimerRef` for long-press detection, but not `doubleTapTimerRef` and `lastTapUpRef` which are used for double-tap detection
   - **Symptoms:** User had to wait an unknown amount of time before the next double-tap would register
   - **Fix:** Added cleanup of both `doubleTapTimerRef` timeout and `lastTapUpRef` timestamp in the cancel handler to ensure clean state for next gesture

## Key Learnings
- **Cancel handlers need comprehensive state cleanup** - When implementing cancel logic, all gesture-related state (timers, timestamps, flags) must be cleared, not just the active gesture's timer. Partial cleanup leads to subtle state corruption.
- **Double-tap detection uses two pieces of state** - `doubleTapTimerRef` (450ms window timeout) and `lastTapUpRef` (timestamp of previous keyup). Both must be reset together to ensure proper detection.
- **Native helper integration** - The app uses a custom C binary (`sonic-helper`) instead of Electron's `globalShortcut` API for hotkey handling, sending `ppt-down`, `ppt-up`, and `ppt-cancel` IPC messages via preload bridge.

## Architecture Decisions
- **Consistent cleanup pattern** - The fix follows the same pattern already used for `pressTimerRef`: check if timer exists, clear it, set to null. This maintains code consistency and readability.
- **Reset both timer and timestamp** - Even though clearing the timeout would technically work, also resetting `lastTapUpRef` to null ensures no stale timestamp affects future calculations.

## Ready for Next Session
- ✅ **Hotkey system fully responsive** - Users can now cancel and immediately restart dictation without any delay
- ✅ **Code pattern established** - Future gesture state additions should follow same cleanup pattern in cancel handler

## Context for Future
This fix ensures the hands-free dictation UX is responsive and doesn't have frustrating delays. The cancel handler now properly resets all gesture detection state (long-press and double-tap), which is critical for a smooth user experience. Any future additions to the gesture system (e.g., triple-tap, custom patterns) should ensure their state is also cleaned up in this cancel handler.
