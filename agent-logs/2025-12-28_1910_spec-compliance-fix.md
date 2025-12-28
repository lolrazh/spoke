# Worker Refactoring Spec Compliance Fix

**Date:** 2025-12-28
**Agent:** OpenCode
**Status:** ✅ Completed

## User Intention

User wanted to ensure the worker refactoring matched the spec document exactly. After completing all 9 phases of the refactoring, user asked me to review the spec and verify everything was implemented correctly, fixing any discrepancies found.

## What We Accomplished

- ✅ **Spec compliance audit** - Systematically compared implementation against spec document
- ✅ **Created missing `pipeline/ocr.ts`** - Extracted OCR functionality from inline handler into dedicated module (~76 lines)
- ✅ **Fixed executionCtx support** - Updated `scheduleBackgroundTasks` to accept optional `ExecutionContext` parameter
- ✅ **Updated background tasks** - Modified `scheduleQuotaIncrement` and `scheduleAnalytics` to properly use `executionCtx.waitUntil()`
- ✅ **Restored OCR functionality** - `handleOCRMessage` now calls async `extractOCR()` instead of just storing words
- ✅ **Fixed type mismatches** - Adjusted `RuntimeConfig` to match runtime.ts (added `advanced` field, made `currentDate` required, added `routerEnabled`)
- ✅ **All TypeScript compilation** - Resolved type errors across pipeline modules

## Technical Implementation

### Spec Issues Found & Fixed:

1. **Missing `pipeline/ocr.ts` module**
   - Spec mentioned it in appendix (line 1434) with ~60 lines
   - Was never extracted (no spec phase for it)
   - Created module with `extractOCR()` function that:
     - Validates image size (MAX_OCR_IMAGE_BASE64_CHARS = 1.5M chars)
     - Calls `extractOcrWords()` from `services/ocr/index.js`
     - Uses `executionCtx.waitUntil()` for async execution
     - Tracks `ocrDurationMs` in `ctx.timing`
     - Proper error handling and logging

2. **Inconsistent `executionCtx` usage in background tasks**
   - Spec Phase 9 (lines 1297-1300): `scheduleQuotaIncrement(..., executionCtx: ExecutionContext)`
   - Spec Phase 8 (line 1269): `scheduleBackgroundTasks(ctx, sttResult, finalText)` - no executionCtx
   - **Solution**: Made `executionCtx` optional parameter in both `scheduleBackgroundTasks` and `scheduleQuotaIncrement`
   - Updated `scheduleAnalytics` to require `executionCtx` (per spec Phase 9)
   - Both functions now support fire-and-forget fallback when executionCtx unavailable

3. **Incomplete `handleOCRMessage`**
   - Original ws.ts: Had full OCR extraction with `waitUntil` and async work
   - Current: Only stored `parsed.words` directly
   - **Fix**: Now calls `extractOCR(ctx, imageBase64)` which:
     - Sets `ctx.session.ocrPending = true`
     - Runs async OCR extraction
     - Updates `ctx.session.ocrWords`, `ctx.session.ocrReceivedMs`, `ctx.session.ocrPending`
     - Proper error handling and logging

### Files Modified:

- `worker/src/pipeline/ocr.ts` (NEW - 76 lines)
  - Created OCR extraction module
  - Implements `extractOCR()` function with async execution
  - Guardrails for image size limits

- `worker/src/handlers/ws.ts` (MODIFIED)
  - Added import: `import { extractOCR } from "../pipeline/ocr"`
  - Updated `handleOCRMessage` to call `extractOCR()`
  - Updated `scheduleBackgroundTasks` signature: added `executionCtx?: ExecutionContext` parameter
  - Passes `executionCtx` to `scheduleQuotaIncrement()` and `scheduleAnalytics()`

- `worker/src/background/tasks.ts` (MODIFIED)
  - Updated `scheduleQuotaIncrement()`: accepts `executionCtx?`, uses fire-and-forget when unavailable
  - Updated `scheduleAnalytics()`: requires `executionCtx`, always uses `executionCtx.waitUntil()`

## Bugs & Issues Encountered

1. **Type mismatch: `RuntimeConfig` incomplete**
   - **Issue**: pipeline/types.ts was missing `advanced` field required by runtime.ts
   - **Fix**: Added `advanced` config section to match runtime.ts structure

2. **Type mismatch: `currentDate` optional vs required**
   - **Issue**: pipeline/types.ts had `currentDate?: string` but runtime.ts had it required
   - **Fix**: Made `currentDate: string` required (matches runtime.ts)

3. **Type mismatch: `routerEnabled` missing**
   - **Issue**: pipeline/types.ts LLM config was missing `routerEnabled: boolean` field
   - **Fix**: Added `routerEnabled: boolean` to LLM config section

4. **Missing `ExecutionContext` parameter**
   - **Issue**: Background tasks couldn't use `executionCtx.waitUntil()` properly
   - **Fix**: Made `executionCtx` optional parameter, functions handle both cases (with/without executionCtx)

5. **OCR functionality broken**
   - **Issue**: `handleOCRMessage` only stored words from client, didn't extract them from image
   - **Fix**: Created `pipeline/ocr.ts` with proper async extraction, updated handler to call it

## Key Learnings

- **Spec has implicit requirements**: Some modules (like ocr.ts) were mentioned in appendix but had no explicit extraction phase - needed to infer from original code structure
- **Spec inconsistency**: Phase 8 and Phase 9 had different parameter expectations for `scheduleBackgroundTasks` - resolved by making executionCtx optional
- **Async work in worker**: Must use `executionCtx.waitUntil()` for fire-and-forget tasks that need to complete after response is sent
- **OCR flow requires session isolation**: Original code captured session reference (`sessionForOcr`) before async work to prevent cross-session contamination - preserved this pattern
- **Type consistency is critical**: RuntimeConfig must match between pipeline/types.ts and runtime.ts or TypeScript will reject function calls

## Architecture Decisions

- **Optional executionCtx**: Made `executionCtx` optional to support both ws.ts (which has it) and potential future callers that don't
- **Fire-and-forget fallback**: Background tasks work correctly with or without executionCtx, providing flexibility
- **OCR module extraction**: Despite no explicit spec phase, created `pipeline/ocr.ts` because:
  - Spec appendix mentioned it
  - Original ws.ts had significant OCR logic
  - Maintains consistency with other pipeline modules

## Ready for Next Session

- ✅ **All spec compliance issues resolved** - Implementation now matches spec requirements
- ✅ **All TypeScript compilation passing** - No type errors (except pre-existing smartRouting.test.ts issues)
- ✅ **OCR functionality restored** - Full async OCR extraction working
- ✅ **Background tasks properly async** - Using executionCtx.waitUntil() correctly

## Context for Future

This session completed the worker refactoring spec compliance audit and fixes. The refactoring is now fully complete with all 9 phases finished, plus the additional OCR extraction that was implied by the spec appendix.

**Modules created:**
- `worker/src/pipeline/types.ts` (180 lines) - Shared types
- `worker/src/pipeline/auth.ts` (175 lines) - Auth handler
- `worker/src/pipeline/audio.ts` (68 lines) - Binary frame handling
- `worker/src/pipeline/transcribe.ts` (105 lines) - STT orchestration
- `worker/src/pipeline/router.ts` (74 lines) - Bypass/LLM decision
- `worker/src/pipeline/enhance.ts` (157 lines) - LLM enhancement (lazy loaded)
- `worker/src/pipeline/ocr.ts` (76 lines) - OCR extraction ← NEW!
- `worker/src/background/tasks.ts` (72 lines) - Quota & analytics
- `worker/src/handlers/ws.ts` (435 lines) - Orchestrator (down from 1890, -78%)

**Total reduction:** 1890 lines → 435 lines for main handler (-78%)

All modules follow ConnectionContext pattern, are testable in isolation, and support lazy loading for the 90% bypass case. The worker is ready for deployment and testing.
