# Dev Server Lifecycle and Shutdown Cleanup

**Date:** 2025-08-22  
**Agent:** OpenAI CLI Agent  
**Status:** ✅ Completed  

## User Intention
Make the dev workflow predictable and low-friction by ensuring the local Worker (port 8787) doesn’t linger after quitting the Electron app, and eliminate noisy Wrangler “hung request” errors on exit. If graceful shutdown proves brittle, prefer a clean split workflow where the worker and app run independently, with simple scripts and an optional convenience to view both.

## What We Accomplished
- ✅ **Clarified dev workflow decision** – Agreed to run Worker and Electron separately in dev to avoid Wrangler’s abrupt-disconnect noise and lifecycle coupling issues.
- ✅ **Updated npm scripts for clarity** – `dev` launches Electron with `SF_DEVTOOLS=1`; `start` is plain `electron-forge start`; `dev:ws` starts the worker on 8787; optional `dev:split` opens two sessions (macOS) for convenience.
- ✅ **Added manual port cleanup** – `scripts/kill-port.js` and `npm run kill:port:8787` to free the dev port if anything gets stuck.
- ⚠️ **Attempted graceful shutdown coupling** – Implemented and tested orchestrator + WS abort + app shutdown handshake; ultimately noisy Wrangler errors persisted, so we removed the orchestrator and adopted split dev.

## Technical Implementation
We first tried coupling the Electron app and Worker: start Worker, wait for 8787, launch Electron, and kill Worker when Electron exits; enhanced the Worker to abort in-flight STT on disconnect; added an app → renderer shutdown handshake to close the WS cleanly. Wrangler still logged a “hung” error when the app terminated first. We pivoted to a split-dev approach with clear scripts and a manual kill-port tool.

**Files Modified:**
- `package.json` – Simplified dev scripts: `dev` = Electron with dev tools; `start` = plain forge; `dev:ws` runs Worker; added `dev:split` convenience; retained `kill:port:8787`.
- `scripts/kill-port.js` – New helper to free port 8787 (macOS/Linux via `lsof`, Windows via `taskkill`).
- `scripts/dev-split.js` – macOS AppleScript launcher: prefers iTerm2 split panes; falls back to Terminal.app.
- `worker/src/index.ts` – WS server hardening: abort in-flight transcription on socket close/cancel; guard sends after close; STT timeout clarified.
- `src/preload.ts` – Exposed `appLifecycle.onShutdown/ackShutdown` bridge (kept; harmless and useful for future coordination).
- `src/hooks/useTranscription.ts` – Listens for `app:shutdown` to cancel/close WS politely before exit (kept; improves general hygiene).
- (Removed) `scripts/dev.js` – Orchestrator deleted per final decision.

## Bugs & Issues Encountered
1. **Port 8787 lingered after app quit** – Worker kept running when Electron closed in dev.
   - **Fix:** Added `kill-port` script; ultimately adopted split-dev so lifecycle is explicit and predictable.
2. **Wrangler “hung request” error on app-first exit** – Dev runtime flags abrupt WS disconnects as canceled/hung.
   - **Workaround:** Even with WS aborts and shutdown handshakes, Wrangler still logs noise. Solution: run processes separately; stop the Worker (X) before quitting the app for zero-noise shutdown.
3. **Terminal integration preference** – iTerm2 vs Ghostty for split view.
   - **Workaround:** Provided `dev:split` AppleScript for iTerm2/Terminal; user opted to run two terminals manually (Ghostty).

## Key Learnings
- **Wrangler dev is strict about abrupt WS exits** – It logs “hung” errors even if the server cleans up, so silencing purely via app-side timing is unreliable.
- **Decoupled lifecycles are simpler in dev** – Independent control of Worker and Electron minimizes race conditions and makes failures obvious.
- **Keep graceful hooks anyway** – Abort signals and polite WS closes are still good hygiene and help during other shutdown paths.

## Architecture Decisions
- **Adopt split-dev as the default** – Separate `dev:ws` and `dev` commands; no background orchestration.
- **Retain cleanup utilities** – Keep `kill-port` and WS abort handling for resilience.
- **Optional ergonomics** – `dev:split` provided for macOS but not required.

## Ready for Next Session
- ✅ **Prepared:** Clear dev scripts (`dev`, `dev:ws`, `start`), port cleanup helper, and hardened WS handling in Worker and renderer.
- 🔧 **Needs work:** If desired, tailor `dev:split` for Ghostty or add docs for preferred terminal workflows.

## Context for Future
The dev workflow is now explicit and reliable: run Worker and app separately, stop Worker first to avoid Wrangler noise. This keeps iteration fast and reduces lifecycle surprises while preserving graceful shutdown building blocks in the code for future enhancements.

