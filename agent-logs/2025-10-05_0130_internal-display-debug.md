# Internal Display Debug Round

**Date:** 2025-10-05  
**Agent:** Droid (ChatGPT)  
**Status:** ⚠️ Partial  

## User Intention
The user wanted the floating pill to reliably snap to the MacBook’s notch width even when Sonic Flow launches or teleports from an external monitor, and asked for thorough logging after the latest attempt still failed.

## What We Accomplished
- ⚠️ **Prototype internal display detection** – Added main-process logic to cache the built-in panel’s ID/native width and emit it to the renderer; renderer used it to decide when to apply notch-specific sizing, but the behavior regressed when returning from a larger external display.
- ❌ **Stable notch width after display hops** – Returning to the laptop screen still produced an oversized pill, so the change was reverted at the user’s request.
- ✅ **Documented session outcome** – Captured this log with next-step recommendations and current understanding for future work.

## Technical Implementation
- Main process attempted to scan all displays at startup, storing `internalDisplayId` and `internalNativeWidth`, and injected those values into each `active-display` payload.
- Renderer replaced ad-hoc `internal` checks with the new metadata, falling back to default token width on externals and only snapping when the active payload matched the cached internal display.
- User reverted the changes following flicker and persistent oversizing on return from the external monitor.

**Files Modified (before revert):**
- `src/main.ts` – Cached built-in display metadata and appended to the active display payload.
- `src/components/App.tsx` – Consumed the new metadata to refine notch targeting and debug HUD output.
- `src/types/shared.ts`, `src/types/electron.d.ts` – Extended payload typings for the extra fields.

## Bugs & Issues Encountered
1. **Pill widens after returning from external display** – Despite caching the built-in panel, the renderer still saw a wider target when the window returned home.
   - **Outcome:** User reverted; root cause not fully isolated. Suspect the first payload on re-entry predates the ID swap, so the renderer sticks with the external width.
2. **Flicker while hovering between displays** – The additional checks caused visible jank when crossing display boundaries.
   - **Workaround:** None yet; removal restored prior stable (but inaccurate) sizing.

## Key Learnings
- **Display IDs shift with window location** – Relying on cursor-follow alone misses the scenario where the window jumps without cursor change; timing matters.
- **`internal` flag is unreliable** – Apple only sets it on genuine built-in panels, but external monitors can still collide on native widths, so fallback heuristics must be careful.
- **Renderer width decisions need state continuity** – Once a wider base width is chosen, we must actively reset it when the window migrates, otherwise the override lingers.

## Architecture Decisions
- **Deferred permanent logging/instrumentation** – Rather than persisting the buggy prototype, we’ll log detailed payloads next to understand window/display sequencing before another rewrite.
- **Favor single-source notch spec** – Future solution should compute the notch target once (from the internal panel) and reset the pill whenever the window rejoins that display.

## Ready for Next Session
- ✅ **Baseline restored** – App is back to the pre-experiment state, so fresh instrumentation can be added safely.
- 🔧 **Need detailed telemetry** – Add structured logging (e.g., main payload dumps, renderer width decisions) to understand why the internal target isn’t re-applying after re-entry.

## Context for Future
We now know the current approach mis-handles the transition back from larger externals; the next pass should focus on logging the display payload ordering so we can rebuild the notch targeting with reliable state and minimal flicker.
