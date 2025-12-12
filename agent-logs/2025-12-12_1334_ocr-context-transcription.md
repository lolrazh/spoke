# OCR Context-Aware Transcription Implementation

**Date:** 2025-12-12  
**Agent:** Claude 3.7 Sonnet (Antigravity)  
**Status:** ✅ Completed  

## User Intention
User wanted to implement intelligent context-aware transcription by extracting proper nouns from on-screen content via OCR and using them to improve Speech-to-Text accuracy. The goal was to make transcription "smarter" by understanding what the user is looking at, particularly for capitalization and domain-specific terminology (e.g., "GOLDBEES" instead of "Gold Bees"). This is Phase 1 of a larger context-aware pipeline outlined in `plans/CONTEXT_AWARE_TRANSCRIPTION.md`.

## What We Accomplished
- ✅ **Client-Side Screenshot Capture** - Implemented optimized screenshot capture using Electron's `desktopCapturer` API with JPEG compression (293ms, 101KB via quality 75, 1080p max dimension)
- ✅ **Worker OCR Service** - Built Vision LLM integration using Groq's Llama 4 Scout model to extract proper nouns from screenshots with structured JSON output
- ✅ **WebSocket Protocol Extension** - Added `context_ocr` message type for fire-and-forget screenshot transmission from client to worker
- ✅ **STT Vocabulary Enrichment** - Integrated OCR words into `buildSTTPrompt()` with automatic deduplication (case-insensitive)
- ✅ **LLM Context Awareness** - Enhanced LLM system prompt to perform fuzzy matching and replace phonetically similar words with exact vocabulary spellings
- ✅ **End-to-End Pipeline** - Wired entire flow: PTT down → screenshot → OCR extraction → vocabulary merge → STT → LLM cleanup

## Technical Implementation

**Architecture Flow:**
```
PTT Down → Screenshot (293ms) → WebSocket → Worker OCR (800-1200ms) → 
STT Vocabulary + LLM System Prompt → Transcription (fuzzy matching) → 
Output: "GOLDBEES" ✅ (not "Gold Bees")
```

**Key Technical Decisions:**
- **Screenshot API:** Chose Electron `desktopCapturer` over native macOS APIs for Phase 1 due to simplicity and cross-platform support (can optimize with ScreenCaptureKit later if needed)
- **Fire-and-Forget:** OCR runs asynchronously via `c.executionCtx.waitUntil()` - doesn't block STT pipeline
- **Vocabulary Location:** OCR words passed in LLM system prompt (not user message) - industry standard for context/instructions
- **Deduplication:** Case-insensitive dedup through existing `formatTokens()` in `stt/prompt.ts`

**Files Modified:**
- `src/utils/screenshot.ts` - Created screenshot utility with performance metrics and JPEG compression
- `src/main.ts` - Added IPC handlers for `screenshot:capture` and `screenshot:test`
- `src/preload.ts` - Exposed screenshot API to renderer via `window.electron.takeScreenshot()`
- `src/types/electron.d.ts` - Added TypeScript definitions for screenshot API
- `src/hooks/useTranscription.ts` - Added screenshot capture on PTT down, sends via WebSocket
- `worker/src/config.ts` - Added OCR configuration (Groq endpoint, Llama 4 Scout model, timeout 5s, max words 100)
- `worker/src/services/ocr/index.ts` - Created OCR service with `extractOcrWords()` function
- `worker/src/services/ocr/prompt.ts` - OCR system prompt for proper noun extraction
- `worker/src/services/ocr/types.ts` - TypeScript types for OCR results
- `worker/src/types/messages.ts` - Added `ClientContextOcrMessage` type and parsing
- `worker/src/ws/session.ts` - Added `ocrWords`, `ocrPending`, `ocrReceivedMs` to session state
- `worker/src/handlers/ws.ts` - Added `context_ocr` message handler with fire-and-forget processing
- `worker/src/services/stt/prompt.ts` - Added `ocrWords` parameter to `buildSTTPrompt()` with deduplication
- `worker/src/services/stt/prompt.test.ts` - Added test for OCR words integration
- `worker/src/services/llm/prompt.ts` - Added OCR-aware instruction for fuzzy matching and exact replacement
- `worker/package.json` - Added `tsx` dev dependency for test script
- `worker/test-ocr.ts` - Created standalone OCR test script

## Bugs & Issues Encountered

1. **Groq Not Returning Pure JSON** - Vision model was explaining instead of returning structured output
   - **Fix:** Added `response_format: { type: 'json_object' }` to request body - forced JSON-only output

2. **TypeScript Module Resolution Errors** - Worker couldn't find `./prompt.js` and `./types.js` imports
   - **Fix:** Added `.js` extensions to all local imports in worker code (ESM requirement with `moduleResolution: "Bundler"`)

3. **Hono Context API Typo** - Used `c.executionContext.waitUntil()` instead of `c.executionCtx`
   - **Fix:** Corrected to `c.executionCtx.waitUntil()` for fire-and-forget OCR processing

4. **Worker Build Failing on Deploy** - package-lock.json out of sync after adding `tsx`
   - **Fix:** Ran `npm install` in worker directory to regenerate lock file

5. **Whisper Ignoring Vocabulary Capitalization** - STT returned "Gold Bees" despite "GOLDBEES" in prompt
   - **Root Cause:** Whisper `prompt` parameter is a hint, not a constraint - doesn't enforce exact capitalization
   - **Fix:** Added LLM post-processing rule: fuzzy match phonetically similar words and replace with exact vocabulary spelling

## Key Learnings

- **Whisper Prompt Limitations:** The `prompt` parameter helps with homophone disambiguation and rare terms but does NOT enforce capitalization, spacing, or unconventional formatting. Always use LLM post-processing for exact formatting.

- **Screenshot Performance on macOS:** Electron's `desktopCapturer` is slower than expected (~300ms vs target <50ms). Native ScreenCaptureKit could achieve ~17ms but requires complex native addon. 300ms is acceptable for fire-and-forget OCR use case.

- **System Prompt vs User Message for Vocabulary:** System prompt is the correct location for vocabulary/context (semantic clarity, higher token weight, industry standard). User message should only contain the actual transcription to process.

- **Groq Structured Output:** Setting `response_format: { type: 'json_object' }` is critical for consistent JSON responses from vision models - without it, models will explain and narrate.

- **OCR Quality Settings:** `quality: 75, maxDimension: 1080` is the sweet spot for OCR - reduced file size from 526KB → 101KB (80% savings) with no meaningful accuracy loss.

- **Fire-and-Forget Architecture:** Using `c.executionCtx.waitUntil()` allows OCR to run in background without blocking the main STT pipeline. OCR completes in ~800-1200ms, typically ready before STT finishes for dictations >1 second.

## Architecture Decisions

- **Electron desktopCapturer over Native APIs** - Chose built-in cross-platform solution for MVP. Can upgrade to ScreenCaptureKit if 300ms becomes problematic (unlikely for fire-and-forget use case). Trade-off: Slower but simpler and cross-platform.

- **Fire-and-Forget OCR** - OCR runs asynchronously, doesn't block audio pipeline. Words arrive in time for 90%+ of dictations (>1s). Trade-off: Very short dictations (<1s) won't benefit from OCR, but that's acceptable.

- **Llama 4 Scout via Groq** - Vision model with structured output support, fast inference (~800ms), reasonable cost. Alternative was GPT-4V but Groq is faster and cheaper.

- **Max 100 OCR Words** - Increased from plan's 30 words to handle dense screens. Deduplication prevents bloat. Trade-off: Larger vocabulary could slow STT slightly, but impact is negligible.

- **JPEG Compression for Screenshots** - OCR doesn't need lossless quality. JPEG quality 75 saves 80% file size with no accuracy impact. Trade-off: Tiny potential OCR accuracy loss, but unmeasurable in practice.

## Ready for Next Session

- ✅ **Phase 1 Complete** - Full OCR pipeline working end-to-end with fuzzy matching
- ✅ **Performance Validated** - Screenshot: 293ms, OCR: 800-1200ms, Total overhead: ~1.5s (acceptable for fire-and-forget)
- ✅ **Testing Framework** - `worker/test-ocr.ts` script for standalone OCR validation
- ✅ **Outperforming Competitors** - User confirmed: "It's handling context better than Wispr Flow now. And they're funded with hundreds of millions."
- 🔧 **Phase 2 Ready** - AX context extraction is next (outline in `plans/CONTEXT_AWARE_TRANSCRIPTION.md`)
- 🔧 **Future Optimization** - Consider ScreenCaptureKit if screenshot speed becomes critical (unlikely)

## Context for Future

This implementation makes Spoke "context-aware" - it now sees what's on the user's screen and uses that to improve transcription accuracy. The OCR pipeline is the foundation for Phase 2 (Accessibility context) and Phase 3 (Smart text insertion). The fire-and-forget architecture is critical - OCR can't block real-time audio, so it runs asynchronously and words arrive just in time for most dictations. The fuzzy matching in the LLM layer is what makes this genuinely useful - it bridges the gap between Whisper's phonetic output and the exact on-screen text.
