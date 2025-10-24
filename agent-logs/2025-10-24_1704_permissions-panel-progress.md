# Permissions Panel Progress

**Date:** 2025-10-24  
**Agent:** GPT-5 Codex  
**Status:** ⚠️ Partial  

## User Intention
The user is driving a staged rollout that moves macOS permission management into a dedicated panel while keeping the main floating pill responsive. They want a centralized controller, actionable notifications, and documentation so future contributors understand the migration plan and remaining milestones.

## What We Accomplished
- ✅ **Documented rollout plan** - Added `docs/PERMISSIONS_PANEL_ARCHITECTURE.md` outlining milestones, risks, and observability expectations.
- ✅ **Tracked delivery status** - Created `docs/PERMISSIONS_PANEL_TODO.md` and checked off milestones 0–5 with notes linking back to implementation details.
- ✅ **Centralized permission polling** - Introduced `src/state/permissionsContext.tsx` so the renderer relies on a single `usePermissions` instance with focus/visibility re-init and snapshot logging.
- ✅ **Actionable notification plumbing** - Extended the preload bridge, type defs, and main-process channel so toasts can carry an `actionId` that the pill reacts to.
- ✅ **Dedicated permissions UI** - Built `src/components/PermissionsPanel.tsx` plus a targeted test to ensure Enable buttons invoke the correct requests.
- ✅ **Pill + Settings integration** - Updated `App.tsx`, `Pill.tsx`, and `SettingsPanel` tests to surface the panel automatically, auto-collapse after recovery, and reuse the shared context.
- ⚠️ **Settings cleanup pending** - Milestone 6 (removing legacy system cards) and Milestone 7 documentation/telemetry follow-up remain open.

## Technical Implementation
Centralized polling now lives in `PermissionsProvider`, which wraps the pill subtree and exposes permission state, UI flags, and request helpers while throttling re-inits to focus/visibility changes. `App.tsx` watches `missingPermissions` to enqueue actionable notifications and collapse logic, while `Pill.tsx` switches between the new `PermissionsPanel` and the existing settings view. The preload bridge and `window.notifications` typings accept optional action IDs, and `main.ts` forwards structured payloads so notification clicks trigger `open-permissions`. Tests were updated to mount components within the provider, and `PermissionsPanel.test.tsx` verifies mic enable flows.

**Files Modified:**
- `docs/PERMISSIONS_PANEL_ARCHITECTURE.md` – Added milestone roadmap and rationale.
- `docs/PERMISSIONS_PANEL_TODO.md` – Captured milestone checklist with status notes.
- `src/state/permissionsContext.tsx` – New provider/context for shared `usePermissions` state.
- `src/hooks/usePermissions.ts` – Added debug logging hooks and polling refinements.
- `src/components/App.tsx`, `src/components/Pill.tsx`, `src/components/PermissionsPanel.tsx`, `src/components/SettingsPanel.tsx` – Integrated controller, panel surfacing, and notification handling.
- `src/preload.ts`, `src/main.ts`, `src/types/electron.d.ts` – Enabled actionable notifications in the Electron bridge.
- `src/components/PermissionsPanel.test.tsx`, `src/components/SettingsPanel*.test.tsx` – Updated tests to cover the new flow.

## Bugs & Issues Encountered
1. **Notification click routing** - Legacy bridge only forwarded message strings, so actions couldn’t be observed in renderer tests.  
   - **Fix:** Added `{ message, actionId }` payloads end-to-end and taught the pill reducer to store and invoke callbacks when the toast is clicked.
2. **Permission poll duplication risk** - Multiple `usePermissions` instances previously spawned overlapping timers.  
   - **Fix:** Provider now governs the single hook and only onboarding keeps a dedicated instance, eliminating duplicate polling in Settings.

## Key Learnings
- **Focus/visibility gating** keeps permission re-checks lightweight without reintroducing the old 8 s mic polling loop.
- **Action IDs in notifications** let the floating pill behave like a command palette trigger, making toasts a reliable entry point.
- **Shared context simplifies tests**; wrapping components in `PermissionsProvider` allowed behavior tests to assert UI without mocking every hook call site.

## Architecture Decisions
- **Provider-first state management** ensures permissions remain a single source of truth and future consumers (e.g., menu bar, dev HUD) can subscribe without new polling layers.
- **Actionable toast flow** chosen over modal prompts so the pill stays the canonical surface and the UX stays consistent with other notifications.

## Ready for Next Session
- ✅ **Controller + panel plumbing** - Centralized state, actionable notifications, and panel UI are stable.
- 🔧 **Settings cleanup** - Replace legacy system cards with a slim “Manage macOS permissions” entry (Milestone 6).
- 🔧 **Docs & telemetry** - Update `docs/AUTH.md`, add analytics hooks, and capture screenshots for Milestone 7 deliverables.

## Context for Future
With the controller, actionable toasts, and dedicated panel in place, the remaining work is primarily UX cleanup and documentation. Removing the old cards and capturing telemetry will finish the permissions migration and make it easier to iterate on onboarding without duplicating state.

