# Dev/Prod/Staging Environment Modes

**Date:** 2025-08-22  
**Agent:** OpenAI Codex CLI Agent  
**Status:** ✅ Completed  

## User Intention
The user wanted a reliable, ergonomic way to run the Electron app against different backends without friction: use the dev tool against either the local dev server or the production API, and build “staging” packaged apps that open DevTools automatically with the ability to target either server. The deeper goal was to remove ambiguity from environment selection, ensure predictable behavior, and streamline manual testing across modes.

## What We Accomplished
- ✅ **Dev run-modes** – Added `npm run dev:local` (uses `ws://127.0.0.1:8787/ws`) and `npm run dev:prod` (uses `wss://api.sonicflow.app/ws`) with no worker auto-spawn, per user preference.
- ✅ **Staging builds** – Added `stage:local:package|make` and `stage:prod:package|make` that open DevTools automatically; local staging also relaxes CSP to allow `localhost:8787`.
- ✅ **Single source of truth for WS endpoint** – Main process now injects a `?ws=...` query parameter for both dev-server and packaged file URLs; the renderer prioritizes this value before any defaults.
- ✅ **CSP/COOP/COEP gating** – CSP allows local HTTP/WS only in dev or when staging flags are set; COOP/COEP are enforced only in strict prod.
- ✅ **Sentry env consistency** – Main uses compile-time `VITE_SENTRY_ENVIRONMENT` and logs effective flags for clear observability.
- ⚠️ **Tray toggle (idea)** – Not implemented yet; deferred as requested.

## Technical Implementation
We centralized environment selection in the main process and used a URL query parameter (`?ws=...`) to explicitly pass the active WebSocket endpoint to the renderer in all modes. The renderer’s `getTranscribeWsUrl()` reads this param with the highest priority and falls back to `import.meta.env` and sensible defaults. We switched staging toggles to compile‑time `VITE_*` flags so packaged apps behave deterministically.

**Files Modified:**
- `package.json` – Added scripts: `dev:local`, `dev:prod`, `stage:local:package`, `stage:prod:package`, `stage:local:make`, `stage:prod:make`.
- `src/main.ts` –
  - Inject `?ws=...` into both dev-server URLs and packaged file URLs via `pathToFileURL` when loading windows.
  - Auto-open DevTools in staging builds using `import.meta.env.VITE_SF_DEVTOOLS`.
  - Relax CSP for local dev sockets only when `VITE_ALLOW_DEV_WS=1` or in dev; enforce COOP/COEP only in strict prod.
  - Log effective flags at startup to make mode/behavior explicit.
- `src/config/api.ts` –
  - Prioritize `?ws=` query param, then `VITE_TRANSCRIBE_WS_URL`, then defaults.
  - Normalize scheme/path (http/https → ws/wss, ensure `/ws`).

## Bugs & Issues Encountered
1. **Dev:prod connected to localhost** – Renderer ignored the prod override and used the default local WS.
   - **Fix:** Main now appends `?ws=wss://api.sonicflow.app/ws` to the dev-server URL; renderer prioritizes this param.
2. **Staging local package used prod WS** – Packaged renderer didn’t receive `VITE_TRANSCRIBE_WS_URL`, falling back to prod.
   - **Fix:** For packaged file URLs, main adds `?ws=ws://127.0.0.1:8787/ws` via `pathToFileURL(...index.html)` before `#/onboarding` or root load.
3. **TypeScript redeclaration error (`allowLocal`)** – Duplicate `const allowLocal` in CSP block.
   - **Fix:** Unified to a single declaration computed from `import.meta.env.VITE_ALLOW_DEV_WS` and `isDev`; also simplified strict-prod COOP/COEP gating.

## Key Learnings
- **Explicit URL wins in hybrid envs:** Passing `?ws=...` from main removes ambiguity when `import.meta.env` may differ between dev server and packaged contexts.
- **Compile-time `VITE_*` for packaged behavior:** Rely on `import.meta.env` flags (e.g., `VITE_SF_DEVTOOLS`, `VITE_ALLOW_DEV_WS`, `VITE_SENTRY_ENVIRONMENT`) to control packaged behavior deterministically.
- **CSP needs both HTTP and WS when local:** Allow both `http://` and `ws://` origins for local dev; enforce COOP/COEP only in strict prod to avoid cross-origin constraints during staging.

## Architecture Decisions
- **Main as single source of truth:** Main decides the WS endpoint and injects it via query param so the renderer can always honor the correct target.
- **Staging equals "dev-like" behavior with guardrails:** DevTools open automatically and CSP is relaxed for localhost in staging but not in prod.
- **Minimal, surgical changes:** Focused diffs (scripts, main load URLs, renderer URL resolver) to avoid unrelated churn.

## Ready for Next Session
- ✅ **Stable run modes** – Dev/prod/staging flows are consistent and observable via logs.
- 🔧 **Optional tray toggle** – Add a tray action to flip between local/prod at runtime (writes `localStorage['sf.localWs']`), if desired.
- 🔧 **Per-channel bundle metadata** – Consider distinct app names/icons/bundle IDs for staging vs prod in `forge.config.ts`.

## Context for Future
These environment modes enable quick manual testing against both local and production backends, and provide a debuggable staging build. Future sessions can add a tray toggle or channel-specific packaging to further streamline QA and release workflows.

