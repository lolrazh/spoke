# Paste Shortcut History UX Enhancement

**Date:** 2025-12-05  
**Agent:** Gemini  
**Status:** ✅ Completed  

## User Intention
The user wanted to improve the UX when the paste-last-transcript shortcut (Cmd+Ctrl+V) fails or appears to fail. Their insight: when users press Cmd+Ctrl+V and don't see text appear (for any reason—wrong focus, secure field, etc.), they naturally double-click the floating pill to access settings. The user wanted to make this a delightful recovery path by automatically opening the **Transcription History** tab when the settings panel is opened within 5 seconds of pressing the paste shortcut. This allows users to quickly copy their transcription manually.

Additionally, the user wanted to investigate why Cmd+Ctrl+V might not be working.

## What We Accomplished
- ✅ **Paste shortcut timing tracking** - Main process now sends IPC event when Cmd+Ctrl+V is pressed
- ✅ **Renderer timestamp tracking** - App.tsx subscribes to paste shortcut events and records timestamp
- ✅ **Smart tab detection on expand** - When pill expands, checks if paste was pressed within 5 seconds
- ✅ **Initial tab prop flow** - Full prop chain from App → Pill → SettingsPanel for initial tab control
- ✅ **Tab sync on re-expand** - SettingsPanel properly resets tab when initialTab prop changes

## Technical Implementation
**Architecture:**
```
Cmd+Ctrl+V pressed
    → main.ts: send 'paste-shortcut-pressed' IPC to renderer
    → preload.ts: exposes onPasteShortcutPressed listener
    → App.tsx: updates lastPasteShortcutTsRef with timestamp

User double-clicks pill (within 5 seconds)
    → App.tsx onExpand: checks (Date.now() - lastPasteShortcutTs) < 5000
    → Sets initialSettingsTab = "history" if within window
    → Passes prop to Pill → SettingsPanel
    → SettingsPanel opens to History tab
```

**Files Modified:**
- `src/main.ts` - Added IPC send for paste shortcut event at line 3727-3730
- `src/preload.ts` - Added `onPasteShortcutPressed` listener in electron bridge
- `src/types/electron.d.ts` - Added TypeScript type for the new listener
- `src/components/App.tsx` - Added timestamp ref, subscribe effect, tab computation logic
- `src/components/Pill.tsx` - Added `initialSettingsTab` prop, passed to SettingsPanel
- `src/components/SettingsPanel.tsx` - Added `initialTab` prop with sync effect for re-expand

## Bugs & Issues Encountered
1. **TypeScript lint errors during incremental changes** - As props were added file-by-file, temporary type errors appeared
   - **Fix:** Completed the full prop chain across all files; tsc confirmed no errors in modified files

## Key Learnings
- **Paste shortcut is silently failing** - The `pasteLastTranscript()` function uses a daemon mode that doesn't parse failure codes from sonic-helper. Failure detection would require parsing `paste:err:*` responses.
- **useState initializer runs once** - Simply passing `initialTab` to useState isn't enough for re-expand scenarios. Used a ref + useEffect pattern to sync when the prop changes.
- **Electron globalShortcut registration can fail** - If another app uses the same shortcut, registration returns false. The code logs this but doesn't notify the user.

## Architecture Decisions
- **No failure detection needed** - Instead of detecting actual paste failure (complex), we optimize for the user's _perceived_ failure. If they double-click within 5 seconds, they probably think it failed.
- **5-second window** - Chosen as reasonable time for user to realize paste didn't work and reach for the pill
- **Clear timestamp after use** - Reset `lastPasteShortcutTsRef` after expand so subsequent expands don't re-trigger history

## Ready for Next Session
- ✅ **Feature complete** - Paste shortcut → history UX is wired end-to-end
- 🔧 **Needs testing** - Should test with `npm run dev` to verify:
  1. Cmd+Ctrl+V triggers paste and sends IPC event
  2. Double-click within 5 seconds opens to History tab
  3. Double-click after 5 seconds opens to Settings tab (normal behavior)

## Context for Future
This change makes the floating pill more "intelligent" about user intent. The pattern (track main process event timestamp → check in renderer on user action) can be reused for other time-sensitive UX enhancements. The paste shortcut failure detection remains a potential future improvement—parsing `paste:err:*` responses from sonic-helper would enable explicit failure notifications.
