# Remove macOS vibrancy from onboarding to eliminate flash

**Date:** 2025-09-16  
**Agent:** GPT-5 (Cursor)  
**Status:** ✅ Completed  

## User Intention
User observed a brief macOS vibrancy “glass” frame when opening the onboarding window before our black/starfield content appeared. They wanted vibrancy fully removed to eliminate the visual flash and any perceived lag at window show time.

## What We Accomplished
- ✅ **Removed macOS vibrancy from onboarding window** – Deleted vibrancy-related BrowserWindow options and made the window opaque with a solid background.
- ✅ **Simplified show path for onboarding** – Removed vibrancy-specific delays and JS; rely on existing renderer-ready show coordination to avoid intermediate frames.
- ✅ **Verified code health** – `src/main.ts` lints clean after edits.

## Technical Implementation
- In `createOnboardingWindow` (main process):
  - Set `transparent: false` and `backgroundColor: "#0f0f0f"` for an opaque, solid backing from first paint.
  - Removed `vibrancy` and `visualEffectState` options entirely.
  - Kept `titleBarStyle: "hiddenInset"` and `trafficLightPosition` to preserve native traffic lights without vibrancy.
- Deleted vibrancy-specific runtime code:
  - Removed `executeJavaScript` that forced `translateZ(0)` and vibrancy logging.
  - Removed the delayed `onboardingWindow.show()` and `invalidateShadow()` calls tied to vibrancy readiness.
  - Trimmed `ready-to-show` fallback to avoid forcing a show that could race with renderer styles.

**Files Modified:**
- `src/main.ts` – Removed vibrancy, made window opaque, pruned vibrancy-specific show logic and JS.

## Bugs & Issues Encountered
1. **First-frame vibrancy flash** – Transparent, vibrant window was being shown while `.onboarding-window` content started at `opacity: 0` and faded in, exposing native glass briefly.
   - **Fix:** Make window opaque and remove vibrancy; avoid any early show while content is transparent.

## Key Learnings
- Combining transparent windows + macOS vibrancy with a content fade-in can expose a system-drawn glass frame before app content renders.
- Coordinating window visibility with renderer readiness prevents first-paint artifacts without extra delays.
- Native traffic lights can be kept via `hiddenInset` without retaining vibrancy.

## Architecture Decisions
- **Decision:** Remove native vibrancy from onboarding for a consistent, theme-aligned, opaque surface.
- **Trade-off:** Lose native glass aesthetic in this surface; gain deterministic first paint and remove transient system visuals.

## Ready for Next Session
- ✅ Onboarding opens without vibrancy flash.
- 🔧 Consider shortening/removing the initial CSS fade on `.onboarding-window`, or adding an opaque base layer to reduce time-to-first-meaningful-paint further.
- 🔧 Update `docs/DESIGN.md` to note onboarding no longer uses native vibrancy.

## Context for Future
This stabilizes the onboarding’s initial visual presentation, aligning with the starfield intro and avoiding system-visual leaks. Future sessions can focus on intro performance and polish without battling first-frame artifacts.


