# Screen Recording Permission Integration

**Date:** 2025-12-12
**Agent:** Claude Sonnet 4.5
**Status:** ⚠️ Partial

## User Intention
User wanted to add Screen Recording permission as a required permission for the OCR context feature (implemented in previous sessions). The goal was to integrate it cleanly into the existing permission system (onboarding + permissions panel) so users grant it during initial setup, ensuring screenshot capture works for OCR-based transcription accuracy improvements.

## What We Accomplished
- ✅ **Type System Updates** - Added `screenRecording` to `PermissionsState`, `PermissionUiState`, and `PermissionProvider` interface
- ✅ **IPC Handlers** - Added `check-screen-recording-permission` and `request-screen-recording-permission` in main.ts
- ✅ **Preload Bridge** - Exposed screen recording check/request methods to renderer
- ✅ **usePermissions Hook** - Added screen recording polling, state management, and `requestScreenRecording()` function
- ✅ **Permissions Context** - Integrated into controller, added to missing permissions detection
- ✅ **Permissions Panel** - Added Screen Recording card (2nd position, after Microphone)
- ✅ **Onboarding Flow** - Added screen recording permission step, updated `allPermissionsGranted` check
- ✅ **Mock Permissions** - Updated dev mock provider for testing
- ⚠️ **Restart Handling** - Identified issue with mid-onboarding app restart flow (incomplete)

## Technical Implementation

**Permission Order in UI:**
1. Microphone
2. **Screen Recording** (NEW)
3. Accessibility
4. Input Monitoring

**Files Modified:**
- `src/hooks/usePermissions.ts` - Added screen recording state, polling, and request handler
- `src/state/permissionsContext.tsx` - Added to controller context and missing permissions check
- `src/components/PermissionsPanel.tsx` - Added screen recording card with `rectangle.on.rectangle` icon
- `src/components/Onboarding.tsx` - Added screen recording permission UI, updated completion check, mock provider
- `src/main.ts` - Added IPC handlers for check/request, added System Preferences URL for `Privacy_ScreenCapture`
- `src/preload.ts` - Exposed `checkScreenRecordingPermission()` and `requestScreenRecordingPermission()`
- `src/types/electron.d.ts` - Added TypeScript definitions for screen recording methods

**Key Implementation Details:**
- Screen recording check uses `systemPreferences.getMediaAccessStatus('screen')`
- Request triggers `desktopCapturer.getSources()` with 1x1 thumbnail to prompt macOS permission dialog
- No direct `askForMediaAccess('screen')` API exists on macOS - screenshot capture is the standard way to request
- Polling pattern matches microphone (1000ms interval, justGranted animation for 800ms)

## Bugs & Issues Encountered

1. **TypeScript Error in Onboarding Mock Reset**
   - **Symptom:** `setPermissions()` call missing `screenRecording` field
   - **Fix:** Added `screenRecording: false` to the reset permissions object in Onboarding.tsx:1330

2. **Mid-Onboarding Restart Flow Issue** ❌ **UNRESOLVED**
   - **Symptom:** Screen recording permission requires app restart to take effect. If user clicks "Quit and Reopen" in macOS dialog mid-onboarding, app restarts and sees authenticated session → skips to main app, ignoring incomplete onboarding
   - **Root Cause:** App startup logic checks `authenticated` flag first, doesn't validate `onboarding_done` from database on every launch
   - **Impact:** User gets stuck in main app with incomplete onboarding, screen recording permission granted but onboarding incomplete
   - **Discussion:** Multiple solutions discussed:
     - Database field `onboarding_in_progress` (rejected as over-engineered)
     - localStorage caching of `onboarding_done` (rejected due to performance concerns about checking DB on every launch)
     - Auto-restart at end of onboarding (discussed but not implemented)
   - **Status:** Requires architectural decision on how to handle authenticated + incomplete onboarding state on app restart

## Key Learnings

- **macOS Screen Recording Permission Behavior:**
  - Cannot be requested via `askForMediaAccess('screen')` API
  - Must trigger via actual screen capture (`desktopCapturer.getSources()`)
  - Requires full app restart for permission to take effect (unlike Microphone/Accessibility/Input Monitoring)
  - macOS does NOT show "Quit and Reopen" dialog automatically - permission grants silently

- **Permission Restart Requirements:**
  - **Microphone:** Works immediately after grant ✅
  - **Accessibility:** Works immediately after grant ✅
  - **Input Monitoring:** Works immediately after grant ✅
  - **Screen Recording:** Requires app restart to function (macOS security requirement) ⚠️

- **System Preferences URL:** Screen recording pane is `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`

- **Onboarding State Management Gap:** Current architecture assumes onboarding completion check only happens at sign-in time, not on every app launch. This creates edge case when user is authenticated but onboarding incomplete (e.g., mid-onboarding restart).

## Architecture Decisions

- **Screen Recording Made Required:** User explicitly required this permission (not optional). All 4 permissions must be granted to complete onboarding.

- **Permission Order:** Placed Screen Recording 2nd (after Microphone, before Accessibility) in UI to group media-related permissions together.

- **No Restart During Onboarding (Discussed):** Original plan was to auto-restart at end of onboarding after all permissions granted. User preferred this to avoid interrupting onboarding flow. Implementation pending resolution of restart handling issue.

- **Polling Pattern Consistency:** Used same polling/state management pattern as microphone permission for consistency and maintainability.

## Ready for Next Session

- ✅ **Permission UI Complete** - Screen recording fully integrated into both onboarding and permissions panel
- ✅ **IPC Layer Complete** - Check/request handlers working, System Preferences integration done
- ✅ **Type Safety** - All TypeScript types updated, no compilation errors
- 🔧 **Restart Flow Needs Design** - Must decide how to handle authenticated + incomplete onboarding state on app restart
- 🔧 **Testing Needed** - End-to-end flow needs manual testing with actual macOS permission dialogs

## Context for Future

This work enables the OCR context feature (from `2025-12-12_1334_ocr-context-transcription.md`) to function properly by ensuring screen recording permission is granted. The permission is required for `desktopCapturer.getSources()` calls in `src/utils/screenshot.ts` to capture screen context for OCR processing.

**Critical Unresolved Issue:** The app needs a strategy for handling mid-onboarding restarts when screen recording permission is granted but requires an app restart. Current options:
1. Auto-restart at end of onboarding (smooth UX, needs implementation)
2. Manual "Quit and Reopen" prompt (user control, but requires restart flow handling)
3. Make screen recording post-onboarding (avoids restart issue, but delays feature availability)

The restart requirement is a macOS platform limitation that cannot be avoided. The chosen solution will affect whether we:
- Check `onboarding_done` on every app launch (performance concern)
- Cache `onboarding_done` in localStorage (sync concern)
- Add `onboarding_in_progress` to database (additional complexity)
- Force onboarding completion before any restart (UX constraint)

This decision should be made before merging to ensure clean onboarding UX in production.
