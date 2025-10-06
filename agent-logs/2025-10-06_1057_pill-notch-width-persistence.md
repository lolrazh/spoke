# Pill Notch Width Persistence

**Date:** 2025-10-06  
**Agent:** Claude 3.5 Sonnet (Droid)  
**Status:** ✅ Completed  

## User Intention
User wanted the floating pill to display with the correct notch width immediately on startup, regardless of which display the app opens on (MacBook with notch vs external monitor). The existing implementation required the user to move their cursor between displays for the correct width to be calculated, which created a poor initial experience for users with multi-monitor setups. The solution needed to work for both new users (during onboarding) and existing users (on first launch after update), with the understanding that a one-time 1-2 second delay for detection was acceptable, but all subsequent launches should be instant.

## What We Accomplished
- ✅ **One-time notch detection on first launch** - Swift `notch-reporter` binary detects built-in display with notch and calculates width once
- ✅ **Persistent storage in user preferences** - Created `pill-preferences.json` (similar to `mic-preferences.json`) to store detected width
- ✅ **Immediate width availability on startup** - Renderer receives stored width instantly on all subsequent launches via `storedNotchWidth` field in IPC payload
- ✅ **Optical adjustment (-2px)** - Subtracted 2px from detected width for better visual alignment (209px → 207px on 16" MBP, 198px → 196px on 14" MBP)
- ✅ **Fixed IPC timing bug** - Re-emit display info in `renderer-ready` handler to ensure renderer receives the message after listener setup
- ✅ **Removed dynamic recalculation** - Eliminated unnecessary width computation on every display change; width is now static from preferences

## Technical Implementation

### Storage Architecture
Created pill preferences storage parallel to existing mic preferences:
- File location: `~/Library/Application Support/sonic-flow-app/pill-preferences.json`
- Format: `{ "notchWidth": number }`
- Load on startup via `loadPillPreferences()`
- Save after first detection via `savePillPreferences()`

### Detection Flow
```typescript
async function detectAndStoreNotchWidth(): Promise<number | null> {
  // 1. Run notch-reporter Swift binary to get all displays
  await refreshNotchInfo("initial-detection");
  
  // 2. Find built-in display with hasNotch: true and isBuiltIn: true
  const builtInWithNotch = notchReport.screens.find(
    (screen) => screen.isBuiltIn && screen.hasNotch && screen.notchWidth > 0
  );
  
  // 3. Apply optical adjustment (-2px)
  const adjustedWidth = builtInWithNotch.notchWidth - 2;
  
  // 4. Store in preferences
  pillPreferences.notchWidth = adjustedWidth;
  savePillPreferences(pillPreferences);
  
  return adjustedWidth;
}
```

### IPC Payload Update
Extended `ActiveDisplayPayload` type to include `storedNotchWidth`:
```typescript
export type ActiveDisplayPayload = {
  id: number;
  bounds: Rect;
  size: Size;
  workArea: Rect;
  scaleFactor: number;
  scale: number;
  window: Rect | null;
  notch?: DisplayNotchInfo | null;  // Per-display notch info (dynamic)
  storedNotchWidth?: number | null;  // Stored width from preferences (static)
};
```

### Renderer Simplification
Replaced dynamic per-display notch calculation with direct use of stored value:
```typescript
// Before: Used payload.notch (dynamic, only available when on correct display)
const nextNotchWidth = 
  notch && notch.hasNotch && notch.notchWidth > 0 ? notch.notchWidth : null;

// After: Use payload.storedNotchWidth (static, always available)
const storedWidth = payload?.storedNotchWidth;
const nextNotchWidth = storedWidth && storedWidth > 0 ? storedWidth : null;
```

**Files Modified:**
- `src/types/shared.ts` - Added `PillPreferences` type and `storedNotchWidth` to `ActiveDisplayPayload`
- `src/main.ts` - Added pill preferences storage, detection function, IPC timing fix, initialization in app.whenReady()
- `src/components/App.tsx` - Simplified to use `storedNotchWidth` directly, removed dynamic notch calculation

## Bugs & Issues Encountered
1. **IPC message sent before renderer ready**
   - **Symptom:** Stored notch width loaded correctly in main process (logs showed 209px), but renderer never received it and fell back to default width
   - **Root cause:** `emitActiveDisplayInfo()` called immediately after window creation (line 1740), but renderer's `onActiveDisplay` listener not set up yet - message was sent into void
   - **Fix:** Re-emit display info in `renderer-ready` IPC handler after renderer signals it's ready to receive messages
   
2. **Initial confusion about dev vs production behavior**
   - **Symptom:** User restarted app multiple times but width didn't apply
   - **Root cause:** Timing issue caused both dev and prod to fail identically; user correctly identified something was wrong
   - **Fix:** Same IPC timing fix resolved both environments

## Key Learnings
- **IPC timing is critical** - Always re-emit state in `renderer-ready` handler for any startup-critical data; window creation happens before renderer listener setup
- **Swift notch-reporter already detects all displays** - No need for complex per-display tracking; just find the built-in display with `isBuiltIn: true` once
- **Optical adjustments matter** - Exact notch width (209px) doesn't equal optimal visual width; -2px adjustment (207px) looks significantly better
- **Preferences pattern is solid** - The existing `mic-preferences.json` pattern (load/save with userData directory) worked perfectly for pill preferences
- **One-time detection is sufficient** - Notch width is hardware constant; no need to recalculate on display changes, just store once and reuse forever

## Architecture Decisions
- **Single source of truth in preferences** - Rather than re-detecting on every launch or display change, detect once and trust stored value; simplifies code and improves startup performance
- **Separate from dynamic display info** - Kept `storedNotchWidth` separate from per-display `notch` payload to maintain clear distinction between static (hardware) and dynamic (current display) data
- **Optical adjustment in detection function** - Applied -2px adjustment at detection time rather than rendering time to keep stored value as the final truth
- **Acceptable first-launch delay** - New users see delay during onboarding (when pill isn't visible yet), existing users see one-time delay on first launch after update; both scenarios are low-impact UX

## Ready for Next Session
- ✅ **Notch width persistence complete** - Pill opens with correct width immediately on all launches
- ✅ **Testing validated** - Works in dev mode with MacBook + external monitor setup
- ✅ **Optical adjustment tuned** - -2px offset provides better visual alignment
- 🔧 **Staging build recommended** - User should create staging build to verify production behavior matches dev

## Context for Future
This work eliminates the need for dynamic notch width calculation across display changes. The pill now has a stable, hardware-based width that's calculated once and reused forever. Future work on display handling (window positioning, scaling, etc.) can safely ignore notch width concerns - it's now a solved problem stored in preferences. If notch dimensions change in future MacBook models, the detection function will automatically adapt on first launch of a new device.

---

## PR #127 Code Review & Refinements

**Date:** 2025-10-06 (same day, post-implementation)  
**Reviewer:** Claude 3.5 Sonnet (Droid)  
**Status:** ✅ Review complete, critical issues fixed  

### Code Review Findings

User requested a thorough code review of PR #127 before merging. Review identified **3 critical**, **3 medium**, and **4 minor** issues.

#### 🔴 Critical Issues

1. **Swift Binary Not Code-Signed**
   - **Impact:** macOS Gatekeeper may prevent execution on user machines
   - **Fix Applied:** ✅
     - Created `build/entitlements/notch-reporter.plist` with minimal entitlements
     - Updated `forge.config.ts` to handle `/notch-reporter` in `optionsForFile`
     - Binary now signed with hardened runtime during packaging
   - **Files Changed:** `forge.config.ts`, `build/entitlements/notch-reporter.plist`, `native/build-helper.sh`

2. **Missing Width Validation**
   - **Impact:** Invalid widths (negative, zero, or absurdly large) could be stored
   - **Fix Applied:** ✅
     - Added bounds checking: widths < 195 → clamp to 196, widths > 215 → clamp to 214
     - Logs warnings when clamping occurs for debugging
     - Handles unexpected hardware or API quirks gracefully
   - **Files Changed:** `src/main.ts` (detectAndStoreNotchWidth function)
   - **Code:**
     ```typescript
     if (adjustedWidth < 195) {
       logger.main.warn(`[PillPrefs] Width ${adjustedWidth.toFixed(2)}px below minimum, clamping to 196px`);
       finalWidth = 196;
     } else if (adjustedWidth > 215) {
       logger.main.warn(`[PillPrefs] Width ${adjustedWidth.toFixed(2)}px above maximum, clamping to 214px`);
       finalWidth = 214;
     }
     ```

3. **Potential Race Condition**
   - **Impact:** Rapid display switching during first launch could trigger multiple detections
   - **Decision:** ❌ NOT FIXED - User correctly identified this as over-engineering
   - **Reasoning:**
     - Runs once per device lifetime (maybe twice if onboarding re-triggered)
     - Detection takes 1-2 seconds; race window is tiny
     - Even if triggered simultaneously, both detect the same hardware width and write identical values
     - No critical resources at stake, just a UI preference
     - Adding mutex/flag adds complexity without meaningful benefit

#### ⚠️ Medium Priority Issues

4. **Inconsistent Logging**
   - **Impact:** Mix of `console.log` and `logger.main` creates inconsistent logs
   - **Fix Applied:** ✅
   - **Changed 11 logging statements across 3 functions:**
     - `detectAndStoreNotchWidth()` - 4 statements
     - `loadPillPreferences()` - 3 statements
     - `savePillPreferences()` - 2 statements
     - Error handlers - 2 catch blocks
   - All `[PillPrefs]` messages now use `logger.main.info/warn/error` pattern

5. **Hardcoded Optical Adjustment**
   - **Impact:** Magic number -2 lacks context and is hard to adjust
   - **Fix Applied:** ✅
   - **Added constant at line 366:**
     ```typescript
     // Optical adjustment for notch width (pixels to subtract for better visual alignment)
     const NOTCH_WIDTH_OPTICAL_ADJUSTMENT = 2;
     ```
   - Used in `detectAndStoreNotchWidth()`:
     ```typescript
     const adjustedWidth = detectedWidth - NOTCH_WIDTH_OPTICAL_ADJUSTMENT;
     ```

6. **No Re-detection Mechanism**
   - **Impact:** Users upgrading to new MacBook with different notch need manual file deletion
   - **Decision:** ❌ NOT NEEDED - User correctly identified preferences are device-local
   - **Reasoning:**
     - Preferences stored in `~/Library/Application Support/sonic-flow-app/pill-preferences.json`
     - Device-local, not synced
     - New MacBook = fresh Application Support folder = automatic re-detection
     - Manual reset mechanism unnecessary

#### 🟡 Minor Issues (Deferred)

7. **Error Handling Could Be More User-Friendly** - Detection failures logged but no visual feedback
8. **Type Safety in sanitizeScreen** - Could be more defensive about unexpected data shapes
9. **Binary Compilation Checks** - build-helper.sh could check Swift errors more robustly
10. **Documentation Size** - PILL_NOTCH_WIDTH.md appears comprehensive (624 lines)

### Files Modified in Review Fixes

- `forge.config.ts` - Added code signing for notch-reporter
- `build/entitlements/notch-reporter.plist` - Created minimal entitlements (NEW FILE)
- `native/build-helper.sh` - Updated build message
- `src/main.ts` - Width validation, constant extraction, logging standardization (30+ lines changed)

### Testing & Validation

✅ **Build verification:**
```bash
npm run postinstall
# Output: notch-reporter built successfully (118KB Mach-O arm64)
./native/bin/notch-reporter  # Confirmed working, detects 209px notch
```

✅ **TypeScript compilation:** No new errors introduced

✅ **Linting:** Pre-existing issues only (no new violations)

### Review Decisions Summary

| Issue | Priority | Status | Reasoning |
|-------|----------|--------|-----------|
| #1 Code signing | 🔴 Critical | ✅ Fixed | Required for user machines |
| #2 Width validation | 🔴 Critical | ✅ Fixed | Safety bounds needed |
| #3 Race condition | 🔴 Critical | ❌ Skipped | Over-engineering, harmless duplicates |
| #4 Logging consistency | ⚠️ Medium | ✅ Fixed | Codebase consistency |
| #5 Magic number constant | ⚠️ Medium | ✅ Fixed | Code clarity |
| #6 Re-detection mechanism | ⚠️ Medium | ❌ Skipped | Already works via device-local storage |
| #7-10 Minor issues | 🟡 Minor | ⏭️ Deferred | Not blocking, future enhancement |

### Final PR State

**Status:** ✅ Ready to merge  
**Total changes:** +1,296 additions, -22 deletions across 11 files  
**Critical path:** Notch detection → Storage → IPC → Renderer consumption  
**Recommended next step:** Test with `npm run package` to verify code signing works in production build

### Post-Review Learnings

- **Good call on race condition:** User's engineering judgment saved time by identifying over-engineering
- **Device-local preferences:** Reminder that macOS app preferences don't sync; new device = fresh state
- **Code review value:** Found 3 critical issues (signing, validation, logging) that would have caused problems in production
- **Constants extraction:** Small refactor (1 constant) significantly improves code maintainability
