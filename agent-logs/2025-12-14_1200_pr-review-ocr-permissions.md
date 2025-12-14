# PR 188 Review & Screen Recording Permission UX

**Date:** 2025-12-14  
**Agent:** Gemini  
**Status:** ✅ Completed  

## User Intention
User wanted to review PR 188 ("Context stuff 2") to determine if it was safe to merge, and address the Screen Recording permission UX issue where users get blocked during onboarding because macOS doesn't reflect the permission change until app restart.

## What We Accomplished
- ✅ **PR 188 Review** - Comprehensive security and code review confirming the PR is safe to merge
- ✅ **Identified OCR word limit** - Found `OCR_MAX_WORDS` was set to 100, changed to 50 per user preference
- ✅ **Simple UX fix for Screen Recording** - Added restart hint text in onboarding permissions step instead of complex engineering solution
- ✅ **OCR temperature adjustment** - User changed OCR LLM temperature from 0.1 to 0.2

## Technical Implementation
The core issue was that macOS caches Screen Recording permission at the process level. When a user enables Screen Recording in System Preferences, macOS updates its database, but the running Electron app still sees "denied" until restart. This was blocking users in onboarding.

**Solution:** Added a simple informational note below the permissions section:
> "You may need to restart Spoke after enabling permissions."

This was chosen over complex solutions like:
- IPC-based "onboarding test mode" flag
- Separate permission tracking for "acknowledged" vs "granted"
- Adding Screen Recording to Settings Panel

**Files Modified:**
- `worker/src/config.ts` - Changed `OCR_MAX_WORDS` from 100 to 50
- `worker/src/services/ocr/index.ts` - User changed temperature from 0.1 to 0.2
- `src/components/Onboarding.tsx` - Added restart hint text with `pt-4` padding

## Bugs & Issues Encountered
1. **Screen Recording blocks onboarding progression** - Users couldn't proceed past permissions step even after enabling Screen Recording
   - **Root Cause:** macOS caches permission state per-process; `getMediaAccessStatus("screen")` returns stale "denied" until restart
   - **Fix:** Simple UX copy informing users they may need to restart

2. **Over-engineering trap** - Multiple complex solutions proposed before finding the simple one
   - **Lesson:** The simplest solution (inform the user) was the right one

## Key Learnings
- **macOS Screen Recording permission is special** - Unlike Microphone/Accessibility, it requires app restart to take effect. This is a macOS limitation, not something we control.
- **`systemPreferences.getMediaAccessStatus("screen")`** caches at process level, not system level. macOS's database is updated immediately, but the running process has stale data.
- **Lateral thinking** - Sometimes the "stupidest" solution (just tell the user) beats complex engineering approaches.

## Architecture Decisions
- **Keep Screen Recording in `missingPermissions`** - Don't remove it from enforcement; it will be detected correctly after restart
- **Don't add permissions to Settings Panel** - Permissions Panel is the correct UI surface; don't clutter Settings
- **Trust macOS** - After restart, permission state is accurate. No need for custom tracking.

## PR 188 Summary (for reference)
The PR combines two features:
1. **OCR Context Extraction** - Screenshots for context-aware transcription vocabulary
2. **Supabase Session Persistence** - Fixes session loss on app restart using `electron-store`

Security review confirmed:
- Session storage is secure (electron-store, file-based)
- IPC handlers properly use contextBridge
- Screenshot capture is main-process only
- OCR API keys stay in worker, never exposed to client
- Prompt injection is protected via sanitization in `buildSTTPrompt()`

## Ready for Next Session
- ✅ **PR 188 safe to merge** - After user testing of onboarding flow
- ✅ **OCR parameters tuned** - 50 word limit, 0.2 temperature
- ✅ **Restart hint in place** - Simple UX solution for permission caching issue

## Context for Future
This session clarified the macOS Screen Recording permission behavior which differs from other permissions. The key insight is that we can trust macOS to have the correct permission state on app restart—we don't need to track "user intent" vs "granted status" ourselves. For any future permission-related work, remember that Screen Recording is the odd one out.
