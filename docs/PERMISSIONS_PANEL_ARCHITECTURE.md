# Permissions Panel Architecture & Rollout Plan

## Why this exists
- Reduce friction for everyday users by hiding “one-time” permission setup from the general Settings surface and dedicating a focused experience that only appears when something is wrong.
- Re-use the existing macOS permission helpers and polling logic (`src/hooks/usePermissions.ts`) instead of forking new code paths.
- Provide an audit trail so future maintainers understand the intent, edge cases, and checkpoints involved in introducing the new permissions panel.

## Current state recap (2025-10)
- `usePermissions` centralizes permission polling, request flows, and success UI flags. Call sites today: onboarding (`src/components/Onboarding.tsx`) and the Settings panel (`src/components/SettingsPanel.tsx`).
- The main process forwards helper status via IPC handlers (`src/main.ts:3135-3408`); the native helper emits `ax-granted` / `im-granted` tokens (`native/sonic-helper.c:880`).
- The pill UI only listens for microphone revocations via an 8 s polling loop and surfaces a toast. Accessibility / input monitoring revokes remain silent.
- Notifications dispatched through `window.notifications.send` carry text only; clicks simply collapse the pill.

## Target experience (high level)
1. A hidden “permission controller” owns a single `usePermissions` instance, polls whenever the app regains focus, and logs snapshots for observability.
2. When any permission goes missing, the controller issues an actionable toast “Permissions required — tap to review.”
3. Clicking that toast (or a manual link from Settings) expands the pill into a dedicated Permissions Panel that lists only the system capabilities.
4. The legacy Settings panel no longer embeds the permission cards, but can open the dedicated panel on demand.
5. Once the user fixes all missing permissions, the controller congratulates them, collapses the panel, and resumes normal polling (no more nagging).

## Design principles
- **Single source of truth**: one `usePermissions` instance, shared via React context (or a lightweight store) so we cannot drift between different polls.
- **Notification-first entry**: users shouldn’t hunt through Settings to discover revoked permissions; alerts must be obvious, actionable, and throttled to state changes.
- **Re-use existing helper hooks**: avoid new Electron IPC channels unless we need new capabilities (e.g., actionable notifications).
- **Instrumentation-ready**: verbose logs (toggled) during development; telemetry hooks baked in for later product metrics.
- **Incremental delivery**: milestones are intentionally linear so we can ship partial work without breaking current UX.

## Milestones & checkpoints

### Milestone 0 — Baseline logging
- Add a small dev-only logger (`debugPermLog`) near `usePermissions` that we can toggle via `window.devFlags` (mirrors other debug utilities).
- Validate existing onboarding + settings flows still initialize permissions correctly; capture sample logs for reference.
- Artifact: log screenshot + note in `agent-logs` once instrumentation is in place.

### Milestone 1 — Central permission controller
- Create `src/providers/PermissionsProvider.tsx` (or co-locate in `src/hooks/`) that mounts a single `usePermissions`.
- Responsibilities:
  - Call `init()` on mount, on `window` focus, and on `visibilitychange`.
  - Expose `{ permissions, ui, requestMicrophone, requestAccessibility, requestInputMonitoring, missingPermissions, lastCheckedAt }` via context.
  - Log each snapshot (`debugPermLog("snapshot", state)`).
- Wire `App.tsx` to wrap the pill tree with this provider.
- Checkpoint: console shows snapshots only once per focus event (no duplicate polls when Settings opens).

### Milestone 2 — Actionable notifications
- Extend the preload bridge (`src/preload.ts:130`) and main process (`src/main.ts` notification handler) to support `notifications.sendWithAction(message, actionId)`.
- Update `window.notifications.on` subscribers (`src/components/App.tsx:742`) so notification payloads include `{ message, actionId }`.
- Add reducer support in the pill so actionable notifications store their callback and execute when the toast is clicked/tapped.
- Temporary dev harness: add a keyboard shortcut or debug button that fires a fake actionable notification and confirm the click plumbing works.
- Checkpoint: Dev logs show “notification action triggered: open-permissions.”

### Milestone 3 — Consumers migrate to provider
- Refactor `SettingsPanel` to consume the shared context instead of calling `usePermissions` directly.
- Ensure onboarding keeps its own `usePermissions` instance (it runs in a separate window; no context sharing).
- Update Vitest suites (`src/components/SettingsPanel.test.tsx`) to wrap the provider.
- Checkpoint: Settings still behaves the same; console confirms polling remains centralized.

### Milestone 4 — Build dedicated permissions panel
- Implement `src/components/PermissionsPanel.tsx` using existing `SettingsCard`, `Button`, etc.
- Surface three states:
  1. **Attention required**: highlight missing permissions + reuse Enable buttons.
  2. **Pending**: show spinners while `ui.*.loading` is true.
  3. **All set**: celebratory state with a “Close” CTA.
- Provide entry points:
  - Auto-open when controller marks `missingPermissions` non-empty.
  - Manual “Review permissions” button in Settings (for reassurance).
- Checkpoint: toggling mock providers in dev shows the panel switch states correctly.

### Milestone 5 — Automatic surfacing & collapse rules
- Remove the ad-hoc mic polling in `App.tsx` after delegating to the controller.
- On transition from `missingPermissions = []` to non-empty, enqueue an actionable notification (“Permissions disabled — click to review”) with actionId `open-permissions`.
- When the notification action fires (or Settings link pressed), set `viewMode = "permissions"` in pill state and dispatch `EXPAND`.
- While the panel is open, re-run controller `init()` every ~1 s (existing hook timer) until `missingPermissions` empties; once clear, emit success toast and collapse.
- Checkpoint: revoke and restore permissions locally; observe logs “missingPermissions -> [‘microphone’]” then “missingPermissions -> []”.

### Milestone 6 — Clean up Settings
- Remove the “System” section from `SettingsPanel` and replace it with a single `SettingsCard` linking to the dedicated panel (“Manage macOS permissions”).
- Ensure all tests/docs referencing the old layout are updated.
- Checkpoint: UI diff approved by design; Settings loads faster with less clutter.

### Milestone 7 — Documentation & telemetry follow-up
- Update `docs/AUTH.md` (permissions section) to mention the new flow.
- Add analytics/event tracking hooks if product wants dashboard metrics (optional if instrumentation backlog exists).
- Capture before/after screenshots and append them to the relevant agent log.

## Observability plan
- **Dev logging**: `debugPermLog` prints file references and timestamps; gated by `window.devFlags.devConsoleLogs`.
- **Production telemetry** (future): track `permissions_panel.opened`, `permissions_panel.fix_attempted`, `permissions_panel.all_granted`.
- **Safety rails**: throttle actionable notifications to one per state transition; store `lastActionToastAt` to avoid spam.

## Risks & mitigations
- **Repeated polling**: multiple consumers might accidentally call `init`. Mitigation: provider is the only entry point, with warnings if additional hooks instantiate.
- **Actionable notification UX**: ensure fallback instructions (e.g., double-click pill) remain if the notification click fails (e.g., user dismissed toast).
- **Permission oscillation**: when users toggle Accessibility repeatedly, ensure the panel doesn’t flicker; rely on `justGranted` flag plus small debounce.

## Next actions
1. Land the documentation + TODO checklist (this file plus `docs/PERMISSIONS_PANEL_TODO.md`).
2. Start with Milestone 0: add logging, capture current behavior, and verify we understand the baseline before shipping code changes.

