# Onboarding Assets Bundling Fix

**Date:** 2025-09-16  
**Agent:** GPT-5  
**Status:** ✅ Completed  

## User Intention
Ensure the onboarding background music and the transparent intro logo are correctly included in packaged builds, following the same reliable bundling approach used for feedback audio and brand assets. Avoid ad-hoc workarounds (like manual extraResources) unless required, and document the right long-term method.

## What We Accomplished
- ✅ **Bundled onboarding music via Vite assets** – Replaced hard-coded path with Vite `?url` import and constructed `new Audio(onboardingMusicUrl)` so the hashed file is included in the app asar and resolves under `file://`.
- ✅ **Bundled transparent intro logo via Vite assets** – Switched `logoSrc` to a Vite `?url` import to ensure the image is emitted and path-correct in packaged builds.
- ✅ **Validated packaging approach** – Confirmed no changes to `extraResource` are necessary because the renderer now references assets via the Vite pipeline.

## Technical Implementation
- Renderer assets (images, audio, etc.) should be imported via Vite with `?url` to emit hashed files and return a runtime URL usable under `file://`.
- Feedback audio already followed this pattern; we applied the same to onboarding music and the transparent logo.
- `extraResource` is reserved for assets not handled by the renderer bundler (e.g., nested helper apps, tray templates for main process usage) and is not required here.

**Files Modified:**
- `src/components/Onboarding.tsx` – Imported `onboarding-music.mp3?url` and `transparent-logo-w-text.png?url`; replaced string paths with imported URLs for `Audio` and `logoSrc` props.

**Files Reviewed (no change):**
- `forge.config.ts` – Verified `extraResource` is only for helper/tray assets and not needed for these renderer assets.
- `public/assets/` – Confirmed presence of `onboarding-music.mp3` and `transparent-logo-w-text.png`.

## Bugs & Issues Encountered
1. **Absolute public paths broke in packaged builds** – Using `new Audio("/assets/..." )` fails under `file://` with asar + hashed asset emission.
   - **Fix:** Import assets via Vite `?url` (`import url from "/assets/file.ext?url"`) and use the returned URL at runtime.

## Key Learnings
- **Renderer assets should flow through Vite.** Importing with `?url` guarantees bundling and correct pathing in production.
- **Main/packager assets differ.** Icons/DMG background in `forge.config.ts` must be file paths at build-time; renderer assets should be Vite-managed URLs at runtime.
- **Avoid unnecessary `extraResource`.** Use it for non-renderer resources (native helpers, tray templates), not for assets the renderer can import.

## Architecture Decisions
- **Standardize on Vite `?url` for renderer assets** to avoid path issues and keep a single, predictable pipeline.
- **Leave `extraResource` unchanged** for this case; keep it focused on native and main-process resources.

## Ready for Next Session
- ✅ **Prepared:** Onboarding music and intro logo are reliably packaged and path-correct.
- 🔧 **Needs work:** Audit for any other absolute `"/assets/..."` references across the renderer (images, audio, or videos) and convert to `?url` imports.

## Context for Future
This aligns onboarding media handling with feedback audio and reduces packaging edge cases. Following this pattern for all renderer assets will keep packaged builds deterministic and minimize future release surprises.


