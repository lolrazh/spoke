# Tray “Check for Updates” + Cadence

**Date:** 2025-09-14  
**Agent:** Codex CLI Agent  
**Status:** ✅ Completed  

## User Intention
User wanted a reliable, visible way to check for app updates from the tray and reduce unpredictability around when updates are checked. Beyond adding the “Check for Updates…” menu item, they wanted a production‑grade polling strategy similar to apps like Raycast, with clear in‑app notifications and fewer surprises from CDN caching or unclear intervals.

## What We Accomplished
- ✅ **Tray manual check** — Added “Check for Updates…” to the tray with stateful label and guards
- ✅ **In‑app notifications** — Surfaced “Checking…”, “Up to date”, “Update found…”, and “Update ready…” using existing notification bridge
- ✅ **Restart action** — Added “Restart and Install Update” in the tray once the update is downloaded
- ✅ **Production cadence** — Interval set to 6h; jittered checks on startup and system resume; exponential backoff on background errors
- ✅ **Fallback manifest probe** — If `electron-updater` delegation isn’t available, main fetches `RELEASES.json` and compares versions for a deterministic user‑initiated result
- ✅ **Docs updated** — Documented manual tray check and cadence/triggers in `docs/UPDATE_PIPELINE.md`

## Technical Implementation
- Hooked `update-electron-app` at `6 hours` and added jittered timers via `scheduleUpdateCheck(jitterMs(60_000, 0.2), reason)` for startup and `powerMonitor.on('resume')`.
- Manual checks prefer `electron-updater` (dynamic `eval('require')` to avoid bundling in dev); updater events drive toasts and enable “Restart and Install Update”. On errors or absence, we fallback to a direct HTTPS fetch of `RELEASES.json` and semver compare.
- Background checks suppress “Checking…”/“Up to date” toasts; only surface “Update found…” and “Update ready…”. User‑initiated checks show all toasts. Guards prevent concurrent checks.
- Tray menu rebuilt on every update state change; “Restart and Install Update” calls `quitAndInstall()` when available, else relaunch fallback.

**Files Modified:**
- `src/main.ts` — Added update state, tray items, updater event bridge, manual check, jittered scheduling, resume trigger, backoff, and toasts
- `docs/UPDATE_PIPELINE.md` — Added “Manual Check (Tray)” and “Cadence & Triggers (Production Policy)” sections

## Bugs & Issues Encountered
1. **Main ‘online’ event** — No stable `online` event in Electron main
   - **Fix:** Removed attempted hook; rely on periodic interval + resume trigger; documented this limitation
2. **Duplicate toasts from fallback** — Manual check could fall through to manifest after updater handled events
   - **Fix:** Return early after `checkForUpdates()` to let updater events own UX; fallback only when delegation fails

## Key Learnings
- `update-electron-app` delegates to `electron-updater`; hooking updater events enables richer UX without switching toolchains.
- CDN caching of `RELEASES.json` is the usual source of “just shipped but not visible” — short TTL + cache purge is essential for predictable checks.
- Background checks should be quiet unless an update is available; users expect noise only on manual checks or when action is needed.

## Architecture Decisions
- **Tray‑first manual check** — Keep the control in the tray for quick access; avoids cluttering the pill menu.
- **Quiet background policy** — No “no update” spam; clear toasts for availability/downloaded only.
- **Fallback manifest probe** — Guarantees manual check feedback even if updater delegation isn’t present (e.g., dev/staging quirks).
- **Jittered triggers + backoff** — Mitigates herd effects and stabilizes behavior across network/resume conditions.

## Ready for Next Session
- ✅ Ready: Package, publish a new version, and validate manual check, resume trigger, and “Restart and Install Update”.
- 🔧 Optional: Add a Settings section showing version and a “Restart and Install Update” button when ready.
- 🔧 Optional: Add renderer‑side network regain signal to nudge a background check when `navigator.onLine` flips to true.

## Context for Future
This brings Sonic Flow’s update experience in line with modern macOS apps: obvious manual check, clear in‑app feedback, and predictable background cadence. It reduces ambiguity for releases and gives a fast verification path when shipping new builds.

