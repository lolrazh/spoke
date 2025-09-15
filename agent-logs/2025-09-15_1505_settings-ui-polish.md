# Settings Panel UI Polish: Version Label and Rounding

**Date:** 2025-09-15  
**Agent:** Codex CLI Agent  
**Status:** ✅ Completed  

## User Intention
Improve the Settings Panel presentation so it feels more polished and nested: move the version label to the bottom-right in normal orientation with clearer wording ("Sonic Flow Beta <version>"), reduce its spacing from the edges, and slightly increase the rounding of settings cards and the panel to achieve a softer, nested feel. Also capture conventions for production version naming.

## What We Accomplished
- ✅ **Version label placement + copy** – Moved embedded settings version from rotated left side to bottom-right; text now reads "Sonic Flow Beta <version>".
- ✅ **Tighter offsets** – Reduced bottom/right offsets to sit closer to the edge (`right-3 bottom-2`).
- ✅ **Card rounding alignment** – Settings cards now use `var(--radius-window)` for a more premium, consistent feel.
- ✅ **Panel rounding softening** – Expanded settings container radius increased to `calc(var(--radius-window) + 2px)` to feel slightly softer/nested relative to the app window.
- ✅ **Consistency in standalone footer** – Standalone settings footer text updated to "Sonic Flow Beta <version>" to match embedded.

## Technical Implementation
- Embedded version label moved and reworded in `SettingsPanel`.
- Card rounding aligned via inline style using existing radius token to keep changes scoped and token-driven.
- Expanded pill (settings container) radius softened via token math; no token values were changed.

**Files Modified:**
- `src/components/SettingsPanel.tsx` – Moved/renamed version label in embedded mode; updated standalone footer text.
- `src/components/SettingsCard.tsx` – Set card container `borderRadius: var(--radius-window)`.
- `src/index.css` – Increased `.pill-core.expanded` border radius to `calc(var(--radius-window) + 2px)`.
- `docs/DESIGN.md` – Documented version label placement/format and radius guidance for Settings Panel and cards.

## Bugs & Issues Encountered
1. N/A – No functional issues; purely presentational changes with token-driven styling.

## Key Learnings
- Using CSS custom properties for radius allows subtle, scoped hierarchy tweaks (`calc(var(--radius-window) + 2px)`) without altering base tokens.
- Consistent version label formatting across surfaces reduces cognitive load; bottom-right works well for low-importance metadata.
- Keeping “channel” (e.g., Beta) in the label helps testers; consider deriving from an env variable for build automation.

## Architecture Decisions
- **Token-first styling** – Avoided hard-coded radii; used `var(--radius-window)` and `calc(...)` for hierarchy.
- **Minimal scope** – Touched only settings-related surfaces; did not modify global tokens to prevent unintended UI drift.
- **Copy format** – Adopted "Sonic Flow Beta <version>"; kept the standalone footer consistent with embedded.

## Ready for Next Session
- ✅ Add env-driven channel label (e.g., `VITE_RELEASE_CHANNEL=beta|stable`) and render "Sonic Flow <channel?> <version>" conditionally.
- 🔧 Consider moving the standalone footer label to bottom-right if we want absolute consistency with embedded.
- 🔧 Audit other surfaces (About dialog, onboarding) for version/channel consistency.

## Context for Future
This brings the Settings UI closer to the intended brand polish and hierarchy. Making the channel label env-driven will simplify pre-release builds and keep copy consistent across environments without manual edits.

