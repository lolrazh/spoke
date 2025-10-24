# Permissions Panel TODO & Checkpoints

Each item lines up with the milestones in `docs/PERMISSIONS_PANEL_ARCHITECTURE.md`. Check items off as we land them; add links to PRs, commits, or logs in the “Notes” column.

| Status | Task | Owner | Notes |
| --- | --- | --- | --- |
| [ ] | Capture baseline permission polling logs (Milestone 0) |  |  |
| [x] | Implement `debugPermLog` flag and verify existing flows (Milestone 0) |  | Added logging hooks in `usePermissions` (see commit) |
| [ ] | Introduce `PermissionsProvider` and centralize polling (Milestone 1) |  |  |
| [ ] | Wire provider to `App.tsx` and expose context hook (Milestone 1) |  |  |
| [ ] | Extend notification bridge to support actions (Milestone 2) |  |  |
| [ ] | Teach pill reducer to handle actionable notifications (Milestone 2) |  |  |
| [ ] | Refactor `SettingsPanel` to consume shared provider (Milestone 3) |  |  |
| [ ] | Update Settings tests + mocks for provider (Milestone 3) |  |  |
| [ ] | Build `PermissionsPanel` component with success/attention states (Milestone 4) |  |  |
| [ ] | Add manual “Review permissions” entry point from Settings (Milestone 4) |  |  |
| [ ] | Replace mic-only polling with controller-driven alerts (Milestone 5) |  |  |
| [ ] | Auto-open panel from actionable notification (Milestone 5) |  |  |
| [ ] | Collapse rules & success toast after permissions granted (Milestone 5) |  |  |
| [ ] | Remove System cards from Settings panel; add slim link (Milestone 6) |  |  |
| [ ] | Update docs/tests to reflect new layout (Milestone 6) |  |  |
| [ ] | Document flow in `docs/AUTH.md` + agent log (Milestone 7) |  |  |
| [ ] | Evaluate telemetry hooks for permissions panel (Milestone 7) |  |  |

_Add new rows if the scope expands (e.g., onboarding cadence changes or analytics needs)._ 
