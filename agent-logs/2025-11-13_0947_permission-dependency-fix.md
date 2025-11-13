# Permission Dependency Fix - Input Monitoring Requires Accessibility

**Date:** 2025-11-13
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention
User wanted to prevent users from enabling Input Monitoring permission until Accessibility permission is granted first. This ensures proper permission dependency ordering and prevents a confusing UX where users could enable Input Monitoring before the prerequisite Accessibility permission. The disabled state needed to be applied consistently in both the permissions settings panel and the onboarding flow, with clear visual feedback that the option is unavailable.

## What We Accomplished
- ✅ **Disabled Input Monitoring in PermissionsPanel** - Added `disabled` field to permission entries, set to `!permissions.accessibility` for Input Monitoring
- ✅ **Disabled Input Monitoring in Onboarding** - Updated button disabled state and added visual opacity feedback (`opacity-40`)
- ✅ **Consistent UX across surfaces** - Both the settings panel and onboarding flow now enforce the same permission dependency
- ✅ **Committed and pushed** - Changes committed with descriptive message and pushed to feature branch

## Technical Implementation
The implementation leverages the existing permission state management system. Both UI surfaces use the shared `usePermissions` hook which provides real-time permission status.

**Key Pattern:**
- Added `disabled: boolean` field to permission entry type in PermissionsPanel
- Set `disabled: !permissions.accessibility` for Input Monitoring entry
- Updated Button component to check `disabled={entry.loading || entry.disabled}`
- Added visual feedback via className conditional: `opacity-40` when accessibility not granted

**Files Modified:**
- `src/components/PermissionsPanel.tsx` - Added disabled field to permissionEntries useMemo, updated Button disabled prop (lines 83-121, 159)
- `src/components/Onboarding.tsx` - Updated Input Monitoring button disabled state and container opacity (lines 1652, 1688)

## Bugs & Issues Encountered
No bugs encountered - straightforward implementation that worked on first attempt.

## Key Learnings
- **Permission entry pattern** - Both PermissionsPanel and Onboarding use similar but not identical patterns for rendering permissions. PermissionsPanel uses a typed array with useMemo, while Onboarding renders inline JSX
- **Visual feedback layers** - Onboarding uses both button disabled state AND container opacity to provide stronger visual feedback that the option is unavailable
- **State management** - The `permissions` object from `usePermissions` hook is reactive and updates automatically when permissions change, so no manual refresh needed

## Architecture Decisions
- **Visual opacity in addition to disabled state** - In the onboarding flow, we added `opacity-40` to the entire permission row (not just the button) to make the disabled state more obvious to users. This provides clearer visual hierarchy compared to just a disabled button.
- **Consistent but surface-appropriate** - Both surfaces enforce the same business logic (can't enable IM without AX) but apply it in slightly different ways that match their UI patterns

## Ready for Next Session
- ✅ **Permission dependency system working** - Input Monitoring correctly disabled until Accessibility is granted in both UI surfaces
- ✅ **Visual feedback clear** - Users can see that Input Monitoring is disabled and will understand they need to enable Accessibility first
- ✅ **Clean commit history** - Changes committed with clear message on feature branch

## Context for Future
This establishes a pattern for permission dependencies that can be applied to other permission relationships if needed in the future. For example, if Microphone permission ever needs to depend on another permission, the same pattern can be followed. The implementation is minimal and doesn't require changes to the underlying permission hooks - just the UI layer that renders the permission controls.
