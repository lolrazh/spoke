# Fix BrowserWindow Creation Race Condition on macOS

**Date:** 2025-12-02  
**Agent:** Claude Opus 4.5  
**Status:** ✅ Completed  

## User Intention
User wanted to investigate and fix a fatal Sentry error (`Cannot create BrowserWindow before app is ready`) that occurred when a friend freshly installed the app and opened it immediately. The error appeared once on first launch but worked fine after dismissing the dialog—user needed both a root cause analysis and a reliable fix.

## What We Accomplished
- ✅ **Diagnosed race condition** - Identified that macOS `activate` event can fire before `ready` event on fresh installs
- ✅ **Implemented canonical fix** - Added `app.isReady()` guard in the `activate` event handler
- ✅ **Verified solution** - Confirmed fix matches Electron best practices via web search (95% confidence)

## Technical Implementation
On macOS, the `activate` event fires when:
- User clicks the dock icon
- App is activated from another app
- **Edge case:** During initial app launch (can race with `ready` event)

The `activate` handler was calling `createOnboardingWindow()` or `createWindow()` without checking if the app was ready, causing the fatal error on fresh installs where `activate` fired before `ready`.

**Fix:** Added early return guard at the top of the `activate` handler:

```typescript
app.on("activate", () => {
  // Guard: Don't create windows before app is ready (can happen on fresh install)
  if (!app.isReady()) {
    console.log("[App Event] activate: App not ready yet, skipping window creation");
    return;
  }
  // ... rest of handler continues safely
});
```

This is safe because `app.whenReady().then(...)` will still create the appropriate window once the app is fully initialized.

**Files Modified:**
- `src/main.ts` - Added `app.isReady()` guard in `app.on("activate")` handler (lines ~3808-3812)

## Bugs & Issues Encountered
1. **`Cannot create BrowserWindow before app is ready` on fresh install**
   - **Symptoms:** Fatal error dialog on first launch, app works after dismissing
   - **Root cause:** macOS `activate` event fired before `ready` event during initial launch
   - **Fix:** Added `app.isReady()` check before any window creation in `activate` handler

## Key Learnings
- **macOS activate event timing:** The `activate` event can fire before `ready` in edge cases, particularly on fresh installs when the user opens the app very quickly after installation
- **Electron best practice:** Always guard window creation in `activate` handler with `app.isReady()` check
- **Why it "fixed itself":** Once the error dialog was dismissed, the app had finished initializing, so subsequent activations worked normally

## Architecture Decisions
- **Early return pattern** - Chose simple guard + return over restructuring the handler, keeping changes minimal and targeted
- **Logging included** - Added console log for debugging future edge cases

## Ready for Next Session
- ✅ **Fix is complete** - Ready to be included in next release
- ✅ **No breaking changes** - Fix is additive and doesn't affect normal operation

## Context for Future
This fix addresses a race condition that only occurs on macOS during fresh installs. The `app.whenReady()` block handles normal initialization; this guard just prevents the `activate` event from trying to create windows prematurely. If similar issues arise with other event handlers that create windows, apply the same `app.isReady()` guard pattern.
