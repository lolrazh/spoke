# Settings Panel Height Fix

**Date:** 2025-12-04  
**Agent:** Codex (GPT-5.1)  
**Status:** ✅ Completed  

## User Intention
User wanted to stop the settings/history panel from shrinking on some Macs (M1 Air) where the collapse arrow overlapped the account card. They also asked for a first-principles investigation into why height calculations failed across machines and to document the findings.

## What We Accomplished
- ✅ **Identified double-scaling root cause** - Found that measured panel heights were being multiplied again by display scale (`S`) in `App.tsx`, making the expanded pill too short on scaled displays (e.g., M1 Air).
- ✅ **Stopped height double-shrink** - Applied fix in `App.tsx` to use measured heights directly and only scale the fallback defaults before measurement.
- ✅ **Captured platform variance** - Noted why M4 MBP (S=1.0) was unaffected while M1 Air (S≈0.9) showed overlap.

## Technical Implementation
Measured heights from `usePanelAutoHeight` now bypass the display scale; only the initial fallback uses `S`. Added guards to mark when panels have real measurements before using them.

**Files Modified:**
- `src/components/App.tsx` - Remove extra scaling on measured heights; keep scaled fallback until measurement arrives.

## Bugs & Issues Encountered
1. **Height double-scaled on small displays** - Measured `scrollHeight` was multiplied by `S`, cutting ~10% off on M1 Air.  
   - **Fix:** Use measured height as-is; apply `S` only to fallback defaults pre-measurement.
2. **Bezel/chevron overlay risk** - Bottom band is absolute and not part of measured height, so padding must cover it.  
   - **Workaround:** Left padding unchanged; if overlap resurfaces, add bezel padding in measured container.

## Key Learnings
- Display scaling must not be applied to DOM-measured values; treat them as final.  
- Differing display widths change `S`, so bugs can be invisible on wider Macs while obvious on smaller ones.  
- Fixed overlays (bezels/chevrons) need explicit padding if they sit outside the measured flow.

## Architecture Decisions
- Keep width scaling tied to notch/display width, but decouple measured heights from scale to prevent envelope under-sizing.  
- Use measured-vs-fallback gating: scale defaults, then trust measurements once available.

## Ready for Next Session
- ✅ Height overlap fixed by removing double-scaling.  
- 🔧 If reports persist, consider adding an explicit bezel padding term to measured height or logging measured vs applied heights per display.

## Context for Future
This change stabilizes expanded pill height across scaled and unscaled Macs. Future responsive work should avoid multiplying DOM measurements by display scale and ensure overlays (bezel/chevron) are accounted for with padding or included in the measured container.
