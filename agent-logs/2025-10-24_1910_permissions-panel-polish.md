# Permissions Panel Polish

**Date:** 2025-10-24  
**Agent:** GPT-5 Codex  
**Status:** ✅ Completed  

## User Intention
Deliver a unified permissions experience that relies on actionable notifications rather than legacy settings cards, aligning the pill expansion with design system sizing while keeping the permissions panel the primary remediation surface. The user also wanted the settings panel to mirror the new panel dimensions for a cohesive expanded pill experience.

## What We Accomplished
- ✅ **Notification UX unification** - Permissions alerts now persist, reopen the dedicated panel on every actionable click, and no longer emit the “All permissions look good!” toast.
- ✅ **Settings panel cleanup** - Removed the System section and associated permission hooks so Settings only hosts defaults and account controls.
- ✅ **Panel sizing alignment** - Set shared content width/height tokens so settings and permissions panels share the slimmer 520 px width, with settings height reduced to ~440 px after user tweak.

## Technical Implementation
Refreshed the permissions notification loop to track missing-permission signatures, auto-switch the pill into the permissions view, and reschedule actionable toasts on interaction. Trimmed SettingsPanel to remove permission hooks and system cards. Updated the shared window constants so both panels inherit the narrower footprint; settings height now uses the globally defined target, which the user further tuned to 440 px.

**Files Modified:**
- `src/components/App.tsx` - Reworked permission notification scheduling, removed the success toast, and forced the panel view to remain on permissions while any grants are missing.
- `src/components/SettingsPanel.tsx` - Dropped the System section and permission bridge calls, leaving defaults/account controls only.
- `src/components/Pill.tsx` - Simplified props since Settings no longer needs a permissions entry point.
- `src/constants/window.ts` - Updated expanded width/height tokens to align settings and permissions panels.
- `docs/PERMISSIONS_PANEL_TODO.md` - Marked Milestone 6 complete with notes about the notification-first flow.

## Bugs & Issues Encountered
1. **Notification action opened Settings instead of Permissions** - First actionable toast defaulted back to the settings view.  
   - **Fix:** Force the pill’s `panelView` to `"permissions"` whenever `missingPermissions` is non-empty and remove the “all clear” toast that reset the view.

## Key Learnings
- **Actionable notification state must drive view selection** - Relying on previous panel state leads to race conditions; explicitly tying `panelView` to permission state avoids inconsistencies.
- **Shared sizing tokens keep panels in sync** - Adjusting `CONTENT_WIDTH/HEIGHT` ensures both panels inherit new dimensions without per-component overrides.
- **Settings hooks should reflect actual responsibilities** - Removing unused permission hooks avoids unnecessary init work and clarifies ownership after the panel split.

## Architecture Decisions
- **Notification-first entry** - Chose to enforce permissions access via actionable toasts instead of secondary settings links to keep remediation consistent.
- **Shared sizing constants** - Centralized width/height values so any future surface (e.g., diagnostics) can align by reusing the same tokens.

## Ready for Next Session
- ✅ **Permissions UI/Auth plumbing** - Notifications and panels are aligned; settings surface is clean.
- 🔧 **Documentation** - Need to author `docs/permissions.md` describing architecture and flow (per user request).

## Context for Future
The permissions workflow is now solely notification-driven, leaving documentation and telemetry (Milestone 7) as the primary follow-ups. The new sizing tokens and settings simplification make it easier to ship future panel variants without reworking layout constants.
