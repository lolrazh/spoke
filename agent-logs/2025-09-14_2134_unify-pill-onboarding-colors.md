# Pill/Onboarding Color Unification + Settings Chevron

**Date:** 2025-09-14  
**Agent:** OpenAI Coding Agent (Codex CLI)  
**Status:** ✅ Completed  

## User Intention
Unify the onboarding window with the pill’s visual style by replacing the glass effect with a solid near-black background, driven entirely by the design system. Ensure all pill states (including the embedded settings view) match exactly, and remove the circular background from the collapse chevron while retaining a clear hover state.

## What We Accomplished
- ✅ **Introduced solid surface token** – Added `--surface-solid: rgba(20, 20, 20, 0.95)` as the single source for pill/onboarding solid surfaces.
- ✅ **Onboarding uses solid token** – `.onboarding-window { background: var(--surface-solid) }`; removed the glass overlay pseudo-element.
- ✅ **Pill (all states) unified** – `--pill-background` now uses `var(--surface-solid)`; expanded/settings state switched to `background: var(--pill-background)`.
- ✅ **Settings root color aligned** – Scoped a contextual override so `.bg-background` inside the expanded pill maps to `var(--pill-background)`.
- ✅ **Semantic card surface token** – Added `--surface-card` and updated card rows to read from it; in expanded pill, we override it to the pill color.
- ✅ **Chevron cleanup** – Replaced circular background button with a ghost icon button (`.pill-collapse-btn`) with color-only hover and focus ring.
- ✅ **Docs updated** – Added “Opaque Surface Tokens” and “Surface Context Tokens” guidance to DESIGN.md, explaining HSL vs RGBA and container overrides.

## Technical Implementation
- Added `--surface-solid: rgba(20, 20, 20, 0.95)` and wired both onboarding and pill backgrounds to it.
- Scoped context in `.pill-core.expanded`:
  - `--surface-card: var(--pill-background)` so settings “cards” match the pill color.
  - `.bg-background` mapped to `var(--pill-background)` to avoid HSL-vs-RGBA drift.
- Replaced the collapse control with `.pill-collapse-btn` (no bg, color hover, accessible focus).

**Files Modified:**
- `src/index.css` –
  - Added `--surface-solid` and `--surface-card` tokens.
  - `.onboarding-window` → solid background; removed `::before` glass overlay.
  - `.pill-wrapper` → `--pill-background: var(--surface-solid)`.
  - `.pill-core.expanded` → `background: var(--pill-background)`; scoped `--surface-card` and `bg-background` mapping; added `.pill-collapse-btn` styles.
  - `.onboarding-permission-row` now uses `var(--surface-card)`.
- `src/components/Pill.tsx` – Replaced collapse chevron button with `pill-collapse-btn` (removed circular bg).
- `docs/DESIGN.md` – Updated opaque surface token value; added “Surface Context Tokens” section with examples and rationale.

## Bugs & Issues Encountered
1. **Settings panel stayed old black** – Root used Tailwind `bg-background` (HSL semantic) which didn’t match RGBA solid.
   - **Fix:** Scoped override inside `.pill-core.expanded` to map `.bg-background` to `var(--pill-background)` and introduced `--surface-card` for component surfaces.
2. **Circular background on chevron** – Explicit utility classes applied a semi‑transparent black circle that changed on hover.
   - **Fix:** Replaced with `.pill-collapse-btn` ghost style; color‑only hover and proper focus‑visible ring.
3. **Onboarding glass tint** – A `::before` overlay applied a glassy tint inconsistent with the new solid look.
   - **Fix:** Removed the pseudo‑element; onboarding now uses the solid token directly.

## Key Learnings
- **Token space mismatch matters** – Mixing HSL semantic tokens (`--background`) with RGBA glass/solid tokens can cause subtle color drift. Prefer semantic surface tokens (e.g., `--surface-card`) and container overrides.
- **Container scoping is powerful** – Mapping tokens at the container (expanded pill) keeps child components consistent without invasive changes.
- **Small UI controls benefit from ghost styles** – Icon-only buttons avoid unintended visual blocks over solid surfaces.

## Architecture Decisions
- **Single solid source (`--surface-solid`)** – Centralized control of pill/onboarding color with preserved 0.95 alpha.
- **Semantic surface token (`--surface-card`)** – Allows global defaults (glass) and context‑specific overrides (solid) without forking component styles.
- **Scoped Tailwind mapping** – Minimal, targeted override for `bg-background` in the embedded settings context.

## Ready for Next Session
- ✅ **Optional:** Align expanded border to use `--pill-border` for perfect consistency (currently slightly stronger for edge definition).
- 🔧 **Audit:** Review other components using `bg-background` or `card-*` classes to migrate them to semantic `--surface-*` tokens where appropriate.

## Context for Future
This unifies all primary UI surfaces under a tokenized solid scheme, enabling quick theme tweaks and future light/dark or accent variants with minimal diff via container‑level token overrides.

