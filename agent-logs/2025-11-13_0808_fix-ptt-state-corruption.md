# Fix Push-to-Talk State Corruption from Duplicate Modifier Events

**Date:** 2025-11-13
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention
The user was frustrated because push-to-talk (hold Right Option) and hands-free mode (double-tap Right Option) stopped working correctly. Instead of the expected behavior, a single tap would start recording and another single tap would stop it. The user discovered that restarting the app temporarily fixed the issue, which pointed to runtime state corruption rather than a fundamental logic bug. They wanted to identify when and why this broke, and fix it permanently.

## What We Accomplished
- ✅ **Diagnosed root cause** - Traced the bug to the native helper's toggle-based state tracking in `sonic-helper.c:708`
- ✅ **Fixed state corruption** - Replaced blind toggling with actual flag state reading from `CGEventFlags`
- ✅ **Validated fix** - User confirmed the fix works correctly on their Mac
- ⚠️ **Initial misdiagnosis** - First attempted to fix `leadingThrottle` in React before finding the real issue

## Technical Implementation
The bug was in the native macOS event tap helper that monitors keyboard events. The old implementation used a simple boolean toggle when it received `flagsChanged` events for Right Option:

```c
// OLD BUGGY CODE
if (code == kVK_RightOption) {
    state->optR = !state->optR;  // Blind toggle
    puts(state->optR ? "optR-down" : "optR-up");
}
```

When macOS sends duplicate `flagsChanged` events (common after sleep, lag, or OS event chatter), the toggle would flip incorrectly:
1. Real keydown → `optR = true` → sends "optR-down" ✓
2. Duplicate keydown → `optR = false` → sends "optR-up" ✗ WRONG
3. Real keyup → `optR = true` → sends "optR-down" ✗ INVERTED

The fix reads the actual modifier state from the event flags instead of toggling:

```c
// NEW CORRECT CODE
if (code == kVK_RightOption) {
    bool optionPressed = (flags & OPT_MASK) != 0;
    if (optionPressed != state->optR) {  // Only signal on actual change
        state->optR = optionPressed;
        puts(state->optR ? "optR-down" : "optR-up");
        fflush(stdout);
    }
}
```

This approach is more reliable than querying `CGEventSourceKeyState()` (which has timing issues) because it reads the state directly from the event being processed.

**Files Modified:**
- `native/sonic-helper.c:706-725` - Replaced toggle logic with flag state reading for both Right Option and Right Command

**Commit:** `3c42163` on branch `claude/fix-push-to-talk-011CV4bs5Uv9g41UUXSAbbkj`

## Bugs & Issues Encountered
1. **Misdiagnosed as React throttle bug** - Initially thought the `leadingThrottle` implementation in `App.tsx` was dropping events
   - **Root cause:** The throttle implementation was actually correct; the real issue was in the native helper sending inverted signals
   - **Lesson:** The fact that restarting fixed it was a key clue that it was runtime state corruption, not a logic bug

2. **Native helper toggle corrupted by duplicate events** - macOS sends duplicate `flagsChanged` events which flipped the boolean out of sync
   - **Fix:** Read actual flag state from `CGEventFlags` instead of toggling blindly
   - **Why this works:** Duplicate events with same flag state are now ignored; only actual state changes emit signals

3. **Another agent tried `CGEventSourceKeyState()` approach** - User mentioned this failed to detect hotkeys
   - **Why it failed:** Hardware state query has timing issues; by the time you query, the state might have already changed
   - **Better approach:** Read from the event itself (our solution)

## Key Learnings
- **"Restart fixes it" = state corruption** - When restarting an app fixes the problem, it's a strong indicator of runtime state corruption rather than a logic bug. The restart clears all refs/state back to initial values.

- **Don't toggle on duplicate events** - macOS can send multiple `flagsChanged` events for the same physical key action (especially after sleep/wake). Simple toggle approaches will flip out of sync.

- **Read event state, don't query hardware** - When processing `CGEvent`s, read the state from `CGEventGetFlags()` instead of querying `CGEventSourceKeyState()`. The event itself is the source of truth for that moment in time.

- **Flag-based detection is reliable** - Using `(flags & OPT_MASK) != 0` to detect modifier state is more robust than keycode-based toggling because it reflects the actual modifier state at event time.

- **Investigation process matters** - Checking recent git commits, looking at when the issue was introduced, and understanding the git history (like the `9f21310` commit that added `leadingThrottle`) helped narrow down the search space.

## Architecture Decisions
- **Keep fix in native helper** - Fixed the root cause at the source (native C code) rather than working around it in the renderer (React). This ensures correct signals are sent to the renderer.

- **Avoid state queries** - Chose to read state from events rather than querying hardware state via `CGEventSourceKeyState()`, which the other agent tried unsuccessfully.

- **Preserve existing IPC protocol** - Maintained the same "optR-down"/"optR-up" signal format so no renderer changes were needed.

## Ready for Next Session
- ✅ **PTT gestures working** - Both push-to-talk (hold) and hands-free (double-tap) now work reliably
- ✅ **State stays synchronized** - Duplicate events no longer corrupt the modifier state
- 🔧 **Binary needs rebuild** - User needs to run `bash native/build-helper.sh` on macOS to compile the fixed native helper into the app bundle

## Context for Future
This fix ensures the native keyboard event monitor stays synchronized with actual hardware state even when macOS sends duplicate events. The approach of reading flag state from events (rather than toggling or querying) is the correct pattern for all modifier key tracking in the native helper. If similar state corruption issues appear with other modifiers, apply the same pattern: check `(flags & MODIFIER_MASK) != 0` and only signal on actual state changes.
