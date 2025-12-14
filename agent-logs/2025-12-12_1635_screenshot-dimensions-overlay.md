# Screenshot Dimensions Overlay Debugging

**Date:** 2025-12-12  
**Agent:** GPT-5.2  
**Status:** ⚠️ Partial  

## User Intention
User wanted to remove an intrusive on-screen overlay (a small bubble near the top-right of the transparent pill window) that shows something like **“640 × 748px”** (often with a title), which appears during the first dictation screenshot capture and once when the pill moves to another display. The goal was to make screenshot-based OCR context capture invisible and non-distracting.

## What We Accomplished
- ⚠️ **Isolated that OCR screenshot capture should not resize the pill window** - Confirmed `desktopCapturer.getSources()` captures the screen into an image buffer and does not require resizing the pill window.
- ⚠️ **Confirmed the symptom correlates with “first time” events** - Overlay appears on first dictation, and once on first display hop, then never again (suggests one-time initialization/overlay rather than steady-state resizing).
- ⚠️ **Attempted to suppress a macOS-style resize HUD** - Tried reducing `setBounds()` usage and preferring `setPosition()` for move-only operations, based on the hypothesis this was macOS’s window-size HUD triggered by programmatic resizing/moving.
- ❌ **Observability efforts did not yield reliable signals for the user** - Multiple debug logging attempts did not surface in a place the user could see, leading to inability to confirm whether the overlay is truly tied to window resize/move events.

## Technical Implementation
**Primary hypotheses explored:**
1. **macOS window “size HUD” triggered by Electron window bounds changes**
   - Reasoning: The overlay includes pixel dimensions (e.g. “640×748px”), and appeared on initial resize/move-like events.
   - Mitigation attempt: Route move-only operations to `setPosition()` and reserve `setBounds()` for true width/height changes.

2. **Chromium/DevTools element overlay**
   - Reasoning: Chromium’s inspect overlays can show element/title + W×H in px; can appear transiently and sometimes only once.
   - Mitigation attempt: Searched for in-app debug HUDs (e.g. `debugPill`) and DevTools auto-open flags; no smoking gun identified during this session.

3. **Screenshot pipeline causing UI overlay**
   - Reasoning: The overlay appears “while taking a screenshot”.
   - Conclusion: `src/utils/screenshot.ts` uses Electron `desktopCapturer` and should not create a UI overlay on its own; more likely indirect timing correlation (e.g. first dictation triggers some window movement).

**Observability attempts (and pitfalls):**
- Added console logging around window moves/resizes and screenshot start.
  - Pitfall: Main-process logs often don’t appear where users look (renderer DevTools console), and packaged app launches may hide stdout.
- Tried to hook window movement events.
  - Pitfall: Electron uses `BrowserWindow` event `"move"` (not `"moved"`). Using the wrong event name can make it look like “no logs ever”.
- Proposed writing a file-based log under `app.getPath("userData")` to avoid console visibility issues.
  - Outcome: User reverted debug code due to still not seeing expected output and the overlay persisting.

**Key user-provided evidence:**
- A log line from screenshot start:
  - `[Screenshot] starting; pillBounds=640x720@(535,-1049)`
  - This shows the pill window bounds at capture time (at least as perceived by the code path logging that line).

**Files Involved / Touched During Debugging (some changes later reverted by user):**
- `src/main.ts`
  - Window creation options: `transparent: true`, `frame: false`, `resizable: false`
  - Continuous follow + display switching: `ensureEnvelopeForDisplay()`, `coalescedSetBounds()`
  - Screenshot IPC handler: `ipcMain.handle("screenshot:capture", ...)`
- `src/utils/screenshot.ts`
  - Uses `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: ... })`
  - Selects a source via `display_id` or display id substring match

## Bugs & Issues Encountered
1. **Debug logs not visible to the user**
   - **Symptom:** User reports “no logs” even after multiple instrumentation attempts.
   - **Cause:** Main-process logs are not the same as renderer console logs; also at least one attempt used the wrong event name (`moved` vs `move`).
   - **Status:** Not fully resolved in-session due to user reverting debug instrumentation.

2. **Overlay persisted despite `setPosition`/`setBounds` routing**
   - **Symptom:** The “640×748px” bubble still appears even after attempts to reduce bounds updates.
   - **Interpretation:** Either (a) remaining code paths still trigger it, or (b) the overlay is not coming from Electron window resizing at all (e.g. Chromium overlay / macOS system overlay unrelated to bounds changes).

## Key Learnings
- **Console visibility is a trap in Electron debugging:** renderer DevTools console ≠ main process stdout. If a bug is in `main.ts`, prefer file logging or in-app notifications for user-driven repros.
- **Event naming matters:** Electron `BrowserWindow` emits `"move"` (not `"moved"`). A wrong event name can completely invalidate instrumentation conclusions.
- **`desktopCapturer` shouldn’t create on-screen UI:** if an overlay appears during capture, it’s likely incidental timing with window positioning, DevTools overlays, or OS-level UI.

## Architecture Decisions
- **Keep changes minimal until the overlay source is proven:** Repeated speculative fixes without reliable telemetry are expensive and frustrating; prioritize capturing a definitive trace of window state transitions during the overlay.

## Ready for Next Session
- 🔧 **Add “always-visible” telemetry path (opt-in):**
  - A small, temporary UI indicator in the pill (or notifications) that shows the last 10 window bounds updates + whether DevTools is attached.
  - Or a file-based log written to `app.getPath("userData")`, plus a UI affordance to open that file.
- 🔧 **Capture a screenshot/video of the overlay:** The exact visual style (font, placement, title shown) is often enough to distinguish macOS resize HUD vs Chromium inspect overlay.
- 🔧 **Confirm DevTools/inspect state:** Verify whether `SF_DEVTOOLS` / `VITE_SF_DEVTOOLS` are set and whether “inspect element” mode might be toggled.

## Context for Future
This issue is blocking the “invisible OCR context capture” experience introduced in the OCR context transcription work (`agent-logs/2025-12-12_1334_ocr-context-transcription.md`, `agent-logs/2025-12-12_1432_merge-safety-ocr.md`). Once the overlay source is identified (macOS HUD vs Chromium overlay vs other), the fix should be small and surgical.


