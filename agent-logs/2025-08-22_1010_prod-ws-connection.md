# Prod WebSocket Connection Unblocked

**Date:** 2025-08-22  
**Agent:** OpenAI CLI Agent  
**Status:** ✅ Completed  

## User Intention
Ensure production dictation works end-to-end by making the Electron app reliably connect to the Cloudflare Worker over WebSockets. The user wanted a thorough audit (permissions, config, build artifacts) and a fix that makes prod connect and stop correctly — not just surface-level logging.

## What We Accomplished
- ✅ **Fixed AudioWorklet loading in packaged builds** – Resolved broken absolute path so the PCM downsampler loads via file:// and the capture pipeline starts.
- ✅ **Unblocked WS connection in prod** – Decoupled socket establishment from audio init so WS connects even if audio init hiccups.
- ✅ **Bundled worklet assets for production** – Copied `public/worklets/*` into the packaged renderer so the worklet script is present at runtime.
- ✅ **Optional visibility for debugging** – Added minimal Worker logs on WS accept/start (non-functional, safe to keep or remove).

## Technical Implementation
The AudioWorklet was referenced with an absolute path (`/worklets/...`), which fails under `file://` in packaged apps. We now compute a dev/prod-safe URL using `import.meta.env.BASE_URL` and `window.location.href`, and we copy the worklet files during the Vite build so they exist in the final bundle. We also invoke the WS connection early in `start()` so connectivity isn’t gated on audio init.

**Files Modified:**
- `src/hooks/useTranscription.ts` –
  - Resolve worklet URL via `BASE_URL` and `window.location.href` instead of `"/worklets/..."`.
  - Call `ensureStreamingSocket()` before worklet loading to proactively establish the WS.
- `vite.renderer.config.ts` – Copy `public/worklets/*` → `worklets/` in packaged renderer output.
- `worker/src/index.ts` – Log on WS accept and on client `start` (diagnostic only).

## Bugs & Issues Encountered
1. **AudioWorklet not loading in packaged app** – Absolute path `"/worklets/pcm16-downsampler.worklet.js"` is invalid under `file://`, causing `addModule()` to throw silently and abort `start()`.
   - **Fix:** Build a relative URL using `import.meta.env.BASE_URL` and `window.location.href`; ensure the file is copied into the app via Vite static copy.
2. **WS not attempted when audio init fails** – Because `start()` threw during worklet load, `ensureStreamingSocket()` was never called and no WS connection was attempted.
   - **Fix:** Call `ensureStreamingSocket()` before audio init to make the socket independent from audio pipeline issues.
3. **Misleading tail behavior** – Worker previously only logged on `final` or `close`, so successful connects without `end` appeared as “no logs”.
   - **Workaround:** Add logs on accept/start (optional; not required for functionality).

## Key Learnings
- **File scheme gotcha:** Absolute paths break under `file://` in packaged Electron apps; prefer `BASE_URL`-aware relative URLs for assets like AudioWorklets.
- **Bundle explicitly:** AudioWorklet scripts aren’t auto-bundled; copy them into the final app (e.g., `public/worklets/*` via `viteStaticCopy`).
- **Don’t gate networking on audio:** Establish the WS early so connectivity isn’t blocked by audio initialization errors.

## Architecture Decisions
- **Use `BASE_URL` for asset resolution** – Works in both Vite dev and packaged builds without special cases.
- **Eager WS connection** – Keeps the transport layer ready and simplifies backpressure/queue behavior.

## Ready for Next Session
- ✅ **Prepared:** Packaged builds now stream PCM frames and connect to `wss://api.sonicflow.app/ws` reliably.
- 🔧 **Needs work:** Optional WS reconnect policy when idle; optional server “connected” ack; consider UI for explicit network errors.

## Context for Future
With prod WS connectivity unblocked, we can focus on reliability (reconnect/ack), latency tuning, and adding features like VAD-based auto-finalization and richer error handling without wrestling with packaging path issues.

