# Voice Activity Detection (VAD) Integration

**Date:** 2025-09-02  
**Agent:** OpenAI Coding Agent (GPT-5)  
**Status:** ✅ Completed  

## User Intention
The user wanted to add client-side voice activity detection to avoid streaming silence to the Worker and enable chunk-friendly behavior later. Beyond just running a model, they wanted a clean, modular architecture, robust packaging (dev/prod), and practical observability to verify VAD is working inside an Electron app.

## What We Accomplished
- ✅ **Gate-only VAD** - Inserted VAD between the audio worklet and WebSocket so silence is dropped while preserving existing WS protocol (start → frames → end)
- ✅ **Modular design** - Split responsibilities across config, engine, decision gate, and streaming gate for swapability and testability
- ✅ **ONNX Runtime Web setup** - Added `@ricky0123/vad-web` + `onnxruntime-web`, hosted ONNX model and WASM locally, and resolved asset URLs for dev http:// and prod file://
- ✅ **Packaging fix** - Ensured ONNX/WASM and worklet files are copied into the packaged renderer via Vite static-copy targets
- ✅ **Runtime logging** - Added opt-in VAD logs (speech_start/end, frame forward/drop) gated behind dev flags for easy verification
- ✅ **Sensitivity tuning** - Exposed and adjusted thresholds (start/end probs, min speech/silence) in `src/config/vad.ts`
- ✅ **Graceful fallback** - Energy-based fallback if the ONNX/WASM path fails to initialize, so UX degrades gracefully

## Technical Implementation
- Client-only integration; server unchanged. The VAD sits after the 16 kHz downsampling worklet and before `streamFrame`.
- Keep 400 ms network frames for protocol stability; internally slice audio into 30 ms Float32 windows for VAD inference.
- Pre-roll ring buffer (leading context) and post-roll policy handled in a streaming gate to avoid clipping syllables.
- Assets hosted under `public/vad` (model) and `public/vad/ort-wasm` (WASM variants). URLs are resolved against `BASE_URL` for dev/prod parity.

**Files Modified:**
- `src/config/vad.ts` - Feature flag, tunables, asset URL resolvers (`getVadModelURL`, `getOrtWasmBaseURL`)
- `src/types/vad.ts` - `VadEngine` interface and types
- `src/utils/vadEngine.ts` - Silero VAD engine wrapper + energy fallback
- `src/utils/vadGate.ts` - Hysteresis/debounce policy for start/end
- `src/utils/vadStreamGate.ts` - Streaming gate: slicing, pre-roll buffer, forward/drop logic, event callbacks
- `src/hooks/useTranscription.ts` - Wired VAD between worklet and WS; added debug logs and metrics counters
- `vite.renderer.config.ts` - Added static-copy targets for `public/vad/silero_vad.onnx` and `public/vad/ort-wasm/*`
- `package.json` - Dependencies: `@ricky0123/vad-web`, `onnxruntime-web`

## Bugs & Issues Encountered
1. **Assets missing in packaged app** - ONNX/WASM didn’t appear under resources
   - **Fix:** Added Vite `viteStaticCopy` targets for `public/vad` and `public/vad/ort-wasm`. Confirmed files are inside `app.asar` at runtime
2. **file:// / CORS path issues** - Direct relative paths can fail or differ between dev and prod
   - **Fix:** Added `getVadModelURL()` and `getOrtWasmBaseURL()` to build absolute URLs from `BASE_URL` and `window.location`
3. **Unavailable Yarn** - Local environment lacked `yarn`
   - **Workaround:** Installed dependencies via `npm install`
4. **Over-sensitivity** - Initial VAD thresholds triggered too easily on background noise
   - **Fix:** Raised `SPEECH_PROB_START` → 0.8, `SPEECH_PROB_END` → 0.5, `MIN_SPEECH_MS`/`MIN_SILENCE_MS` → 200 ms (config-only change)

## Key Learnings
- **ORT Web variants** - Provide multiple WASM builds (`simd`, `threaded`, combined) so the runtime can auto-select and gracefully fall back
- **Electron packaging** - Vite static-copy plus `BASE_URL`-aware URL resolution are essential for assets in `app.asar`
- **VAD placement** - Doing VAD after stable resampling (16 kHz) and before network keeps the protocol untouched and reduces server load

## Architecture Decisions
- **Gate-only first** - Keep the WS session model unchanged; plan auto-chunking as a phase two for cleaner transcripts across long dictations
- **SRP modules** - Separate model, policy, streaming glue, and orchestration to make future swaps (different VAD, thresholds, chunking) trivial
- **Local assets** - Bundle ONNX/WASM locally for offline-friendly, deterministic loads (no CDN dependency)

## Ready for Next Session
- ✅ **Auto-chunking scaffold-ready** - `vadStreamGate` emits events suitable for a chunker (end → final → restart) when enabled
- 🔧 **Threshold tuning** - Adjust `SPEECH_PROB_*`, `MIN_*_MS`, and `PRE_ROLL_MS` based on real mic environments
- 🔧 **Tests** - Add unit tests for gate policy and stream gate windowing, plus a small audio fixture for regression

## Context for Future
This VAD layer reduces bandwidth and cuts silence before transcription, paving the way for per-utterance chunking and improved responsiveness. The modular design will make it easy to swap models, refine thresholds, or enable auto-chunking without touching the server.
