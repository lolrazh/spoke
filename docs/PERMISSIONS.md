# PERMISSIONS ARCHITECTURE

**References:**  
- `agent-logs/2025-10-24_1704_permissions-panel-progress.md`  
- `agent-logs/2025-10-24_1910_PERMISSIONS-PANEL-POLISH.md`

---

## 1. Purpose & Philosophy
- **Purpose:** Move all macOS permissions (Microphone, Accessibility, Input Monitoring) into a dedicated, discoverable workflow that surfaces only when needed, reducing first-run friction while ensuring revokes are caught quickly.
- **Experience Goals:**
  - **Notification-first remediation** – Users should never dig through settings; actionable pill notifications are the single entry point.
  - **Single source of truth** – One polling loop, one panel, one set of request handlers.
  - **Focused UI** – Settings remains a lightweight defaults/account surface; the permissions panel is a guided checklist.
  - **Glassmorphic consistency** – Layout, spacing, and motion match the settings panel so the pill feels like one coherent surface.
- **Rollout Philosophy:** Build incrementally (milestones at bottom), keep the floating pill responsive at all times, and leave a clear paper trail in logs for future agents.

---

## 2. End-to-End Flow
1. **Monitoring** – `PermissionsProvider` mounts a single `usePermissions` instance. It polls on app focus/visibility, stores the latest snapshot (`permissions`, `ui`, `missingPermissions`), and exposes request helpers.
2. **Detection** – When the sorted signature of `missingPermissions` changes, `App.tsx`:
   - Forces `panelView = "permissions"` while any grants are missing.
   - Dispatches an actionable notification with `actionId = "open-permissions"`.
   - Schedules repeating notifications (`PERMISSION_NOTIFICATION_REPEAT_DELAY_MS`) until all grants return.
3. **Notification UX** – Toast copy is fixed (`"Permissions required. Double click to review."`). Duration is 6 s (`PERMISSION_NOTIFICATION_DURATION_MS`); replays fire every 8 s unless resolved.
4. **User Interaction** – A double-click (or keyboard activation) on the notification calls back into the pill, expands the permissions panel, focuses the window, and schedules the next reminder after a short pause (`PERMISSION_NOTIFICATION_INTERACTION_DELAY_MS`).
5. **Remediation** – The panel buttons call the provider’s request methods. These trigger system dialogs and poll for grant completion.
6. **Resolution** – When the provider reports no missing permissions, timers clear, the pill collapses if auto-opened, and no success toast is emitted (noise reduction).

---

## 3. Key Modules & Responsibilities
| Module | Responsibility |
| --- | --- |
| `src/hooks/usePermissions.ts` | Talks to preload bridge (`window.electron`), handles polling cadence, toggles loading flags, detects newly granted permissions, and respects dev logging flags. |
| `src/state/permissionsContext.tsx` | Provides a React context so multiple components (pill, panel, tests) consume the same state without duplicating polls. Tracks `lastSnapshotAt` for debugging. |
| `src/preload.ts` / `src/main.ts` | Exposes `window.notifications.send(message, actionId)` and pipes renderer notifications through `ipcRenderer`. Action IDs round-trip untouched. |
| `src/components/App.tsx` | Hosts the pill state machine, compares permission signatures, manages notification timers, enforces view switching, and drives pill expand/collapse logic. |
| `src/components/PermissionsPanel.tsx` | Renders the three permission cards, wires enable buttons, displays granted states, and mirrors settings styles (`SettingsCard`, motion tokens). |
| `src/components/SettingsPanel.tsx` | Presents defaults/account controls only. No permission logic remains, preventing double polling. |

---

## 4. Notification Logic Details
- **Signature tracking:** A sorted string of missing permission keys (e.g., `"accessibility|microphone"`) avoids duplicate notifications unless the set changes.
- **Timers:** One timeout reference (`permissionNotificationTimerRef`) governs repeats; cleared immediately on resolution or component unmount.
- **Action handling:** Both notification clicks and pill double-click gestures dispatch the same `open-permissions` action, ensuring a single expansion pathway.
- **State machine integration:** The pill’s “NOTIFICATION” state now calls `ANIM_DONE` after the configured duration. Permission toasts use the longer duration; all other notifications remain at the default 2 s.
- **Success toast removed:** Previously, an “All permissions look good!” toast could overwrite actionable messages. Removal keeps the notification pipeline consistent and avoids toggling the panel back to Settings prematurely.

---

## 5. Panel & Layout Specs
- **Shared sizing tokens (`src/constants/window.ts`):**
  - `CONTENT_WIDTH = 520` (applies to both panels)
  - `PERMISSIONS_CONTENT_HEIGHT = 320`
  - `CONTENT_HEIGHT = 440` (settings panel envelope)
  - Derived `ISLAND_WIDTH/HEIGHT` keep shadow padding uniform.
- **UI states:** Warning cards with “Enable” CTA, loading spinner when a request is pending, and green check icon on success. No celebratory state; success is implied by return to Settings.
- **Design alignment:** Uses `SettingsCard`, shared section separators, `MOTION.springs.quick` animations, and tokenized colors/spacing so it feels native to the glassmorphic system.

---

## 6. Historical Milestones
| Milestone | Outcome | Notes |
| --- | --- | --- |
| 0 – Logging baseline | Added `debugPermLog` flag to `usePermissions` for focused debugging. | Helps track helper responses and poll cadence. |
| 1 – Central controller | Introduced `PermissionsProvider`, wrapped pill tree, removed duplicate hooks. | Prevents overlapping polling and race conditions. |
| 2 – Actionable notifications | Extended preload/main bridge, taught pill reducer to store action callbacks. | Enables direct navigation from toast clicks. |
| 3 – Consumer migration | Settings panel reuses provider; onboarding keeps isolated instance. | Maintains single source of truth per renderer. |
| 4 – Dedicated panel | Built permissions panel component, tests, and manual entry from Settings (later removed). | Panel replicates settings styling. |
| 5 – Auto surfacing | Replaced mic-only polling with controller-driven alerts, auto-opened panel, auto-collapse on recovery. | Established notification-first workflow. |
| 6 – Settings cleanup | Removed System cards, sized panels consistently, notification loop refined to keep pill in permissions view. | Current session finalized this stage. |
| 7 – Telemetry (pending) | Add instrumentation, analytics, and documentation artifacts. | To be completed. |

All steps were documented in the referenced logs, which capture rationale and troubleshooting details.

---

## 7. Testing & Observability
- **Unit tests:** `src/components/PermissionsPanel.test.tsx` validates button wiring; `src/components/SettingsPanel.test.tsx` covers device enumeration and state queries. Additional suites (hooks, worker, etc.) remain green aside from legacy unrelated failures.
- **Manual checklist:** Trigger missing permissions (e.g., revoke accessibility) and verify toast loop, panel auto-open, request flow, and collapse on restoration.
- **Debug logging:** Enable `window.devFlags.devConsoleLogs` to view `[Permissions]` snapshots, notification actions, and scheduler traces.
- **Future telemetry (Milestone 7):** Plan to emit events such as `permissions_panel.opened` and `permissions_fix_attempted` once instrumentation backlog is cleared.

---

## 8. Future Considerations
- Add analytics once instrumentation slot opens.
- Consider screenshot automation for onboarding/support documentation.
- Maintain `docs/PERMISSIONS.md` as the authoritative guide; `docs/AUTH.md` no longer covers macOS permissions.

For deeper historical context or implementation reasoning, consult the two session logs dated 2025-10-24 listed at the top of this document. They describe the staged rollout and the polish work that removed Settings dependencies and finalized notification behavior.
