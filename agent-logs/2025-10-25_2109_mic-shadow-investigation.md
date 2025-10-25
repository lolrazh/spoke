# Mic Shadow Investigation

**Date:** 2025-10-25  
**Agent:** Codex (GPT-5)  
**Status:** ❌ Failed  

## User Intention
Diagnose and eliminate the sudden darkening of the settings panel shadow that appears whenever the microphone selector dropdown opens or is hovered, preserving the existing pill/window styling.

## What We Accomplished
- ❌ **Token-only shadow tuning** - Softened dropdown glass tokens and offsets; effect still reproduced so user reverted the changes.
- ❌ **Radix Select styling audit** - Removed Tailwind shadow utilities from `SelectContent`; no observable improvement.
- ❌ **Design documentation updates** - Documented new tokens before revert; none of the approaches reduced the flicker.

## Technical Implementation
Explored design-token adjustments (`--shadow-floating-popover`, `--blur-popover`) and Radix `Select` popover positioning to prevent stacked shadows; all edits were backed out after validation failed.

**Files Modified:**
- None (all experimental edits reverted at user request)

## Bugs & Issues Encountered
1. **Shadow darkening when mic dropdown opens** - Stack of popover glass effects appears to multiply the pill shadow.  
   - **Fix:** None achieved; prior attempts (shadow token tweaks, popover offsets, removing extra shadows) proved ineffective and were reverted.

## Key Learnings
- **Popover blur interactions** - Portal-based dropdowns can re-blur parent shadows, but simple token tweaks did not stop the visible amplification.
- **Token scope limits** - Adjusting shared tokens risked broader visual regressions without solving the micro panel issue.
- **Need for instrumentation** - Visual guessing is insufficient; we need runtime inspection (DevTools layers/screenshot traces) to isolate the stacking behavior.

## Architecture Decisions
- **Revert unsuccessful styling tweaks** - Keeping the original design system avoids accidental regressions until a verified fix is identified.
- **Postpone token expansion** - New popover tokens remain undocumented since they are not in use after the revert.

## Ready for Next Session
- ✅ **Reliable repro retained** - Open Settings → click/hover the microphone selector to see the darkening.
- 🔧 **Deeper diagnostics required** - Capture compositor/layer traces or inspect CSS variable mutations during the interaction.

## Context for Future
Future work should pair design-token exploration with DevTools layer/screenshot analysis to pinpoint which surface actually darkens; once confirmed, target only that element to keep the pill shadow stable without broad styling changes.
