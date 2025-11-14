# Responsive Settings & Permissions Layout

**Date:** 2025-11-14  
**Agent:** Codex (GPT-5.1)  
**Status:** ✅ Completed  

## User Intention
The user wanted the embedded settings and permissions panels inside the pill to size themselves automatically based on content so UI stays consistent on different Macs, and to standardize the vertical spacing rhythm so headings, cards, and the collapse chevron never overlap regardless of content changes.

## What We Accomplished
- ✅ **Responsive panel envelope** - Added `usePanelAutoHeight` hook plus App/Pill plumbing so expanded height follows live content for both settings and permissions.
- ✅ **Consistent section spacing** - Rebuilt the layout stacks, tuned padding, and added new `--panel-section-offset` / `--panel-heading-gap` tokens so headings + cards align with identical rhythm across panels.
- ✅ **Design system update** - Documented the new spacing primitives in `docs/DESIGN.md`, ensuring future components reuse the same tokens.

## Technical Implementation
- Created `src/hooks/usePanelAutoHeight.ts` using `ResizeObserver` (+ fallbacks) to report each panel’s natural `scrollHeight`.
- `App` now stores latest heights per panel and passes callbacks into `Pill`, which forwards them to `SettingsPanel` / `PermissionsPanel` and drives `EXPANDED_H`.
- Settings/Permissions sections switched from ad-hoc Tailwind gaps to token-driven inline styles; `SectionSeparator` now respects `--panel-heading-gap`.
- Added spacing tokens to `:root` in `src/index.css` and documented them in `docs/DESIGN.md`.

**Files Modified:**
- `src/hooks/usePanelAutoHeight.ts` - New hook for measuring content height.
- `src/components/App.tsx` - Track measured heights, supply callbacks, adjust expanded size calc.
- `src/components/Pill.tsx` - Forward height callbacks into each panel.
- `src/components/SettingsPanel.tsx` - Use hook, restructure layout, leverage spacing tokens.
- `src/components/PermissionsPanel.tsx` - Same token-based spacing + height reporting.
- `src/index.css` - Added spacing tokens.
- `docs/DESIGN.md` - Documented new panel spacing primitives.

## Bugs & Issues Encountered
1. **Inconsistent heading gaps due to mixing `gap-*` with utility margins** – Account section inherited extra space.  
   - **Fix:** Removed parent `gap`, moved offsets into section styles, and centralized via `--panel-section-offset`.
2. **Settings height previously hard-coded** – Caused chevron overlap on taller devices.  
   - **Fix:** Height hook now feeds the pill dimensions so the window scales with real content.

## Key Learnings
- **ResizeObserver is reliable inside Electron renderers** when paired with `requestAnimationFrame` batching to avoid layout thrash.
- **Spacing tokens should cover contextual rhythms**, not just generic gaps, or panels drift when Tailwind utilities stack.
- **Sharing measurement callbacks through the pill FSM** keeps animation physics intact while still allowing responsive content.

## Architecture Decisions
- **Tokenize panel spacing** so future sections (or localization changes) stay synchronized without manual tweaks.
- **Drive expanded height entirely from measured content** rather than approximations, trading a small hook for perfect chevron alignment.

## Ready for Next Session
- ✅ `usePanelAutoHeight` + spacing tokens are reusable for other panels.
- ✅ Settings/permissions views now resize automatically, so adding/removing cards won’t need envelope changes.
- 🔧 If new UI surfaces need different rhythms, consider promoting additional spacing tokens instead of inline overrides.

## Context for Future
These changes ensure the floating pill can host richer settings/permissions content without manual envelope tuning; future UI work can rely on the new spacing tokens and height hook to stay responsive across devices.
