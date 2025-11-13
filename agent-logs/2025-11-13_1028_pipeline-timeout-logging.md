# Pipeline Timeout Logging & Diagnostic Tools

**Date:** 2025-11-13
**Agent:** Claude (Sonnet 4.5)
**Status:** ✅ Completed

## User Intention
User was frustrated with unreliable dictation - the app frequently timed out without any indication of which component was failing. They couldn't tell if Groq (STT) or Baseten (LLM) was causing the problem, making it impossible to debug or fix the reliability issues. They needed comprehensive logging to instantly diagnose where timeouts were occurring in the transcription pipeline.

## What We Accomplished
- ✅ **Comprehensive pipeline logging** - Added detailed logging throughout STT and LLM stages with timing information
- ✅ **Timeout/abort tracking** - Added explicit logs when operations timeout or are aborted, with reason and elapsed time
- ✅ **Error stage identification** - Enhanced error handling to explicitly identify whether STT or LLM failed
- ✅ **Debug visualization script** - Created color-coded log parser for instant visual diagnosis
- ✅ **Documentation** - Created DEBUG.md with usage examples and quick fixes

## Technical Implementation

### Logging Architecture
Added structured JSON logging at every critical point in the pipeline:

**STT (Speech-to-Text) Logging:**
- `stt.request` - When transcription starts (includes timeout, audio size, provider)
- `stt.complete` - When transcription succeeds (includes duration, text length)
- `stt.abort` - When STT is aborted (includes reason: "timeout" or "external_signal", elapsed time)

**LLM (Language Model) Logging:**
- `llm.request` / `edit.request` - When LLM processing starts (includes timeout, model, streaming settings)
- `llm.complete` / `edit.complete` - When LLM succeeds (includes duration, success status)
- `llm.abort` / `edit.abort` - When LLM is aborted (includes reason and elapsed time)

**Error Logging:**
- `pipeline.error` - Comprehensive error with stage identification (`"stage": "stt"` or `"stage": "llm"`), error details, and STT completion status

### Implementation Pattern
Moved timing variables outside try blocks to ensure they're accessible in catch blocks for error duration logging:

```typescript
const sttStartTime = Date.now();
try {
  const res = await transcribeWav(...);
  const sttDuration = Date.now() - sttStartTime;
  // Log success
} catch (error) {
  const sttDuration = Date.now() - sttStartTime;
  // Log error with duration
}
```

### Debug Script Features
Created `worker/debug-logs.sh` that:
- Parses JSON logs from `npm run dev:ws` output
- Color-codes different event types (blue=STT, magenta=LLM, green=success, red=error)
- Shows clear failure indicators with problem source identification
- Passes through non-JSON output for compatibility

**Files Modified:**
- `worker/src/handlers/ws.ts` - Added request/complete/error logging for STT, LLM, and Edit modes
- `worker/src/services/stt/providers/groq.ts` - Added timeout and abort logging with reason tracking
- `worker/src/services/llm/baseten.ts` - Added timeout and abort logging with reason tracking
- `worker/debug-logs.sh` - New: colored log parser script
- `worker/DEBUG.md` - New: debug documentation with examples

## Bugs & Issues Encountered

1. **TypeScript scope error with editStartTime**
   - **Problem:** Variable declared inside try block was referenced in catch block, causing TS2552 error
   - **Fix:** Moved `const editStartTime = Date.now()` outside the try block so it's accessible in catch

2. **Ambiguous error messages**
   - **Problem:** Original error handling said "Transcription error" even when LLM failed
   - **Fix:** Added stage detection (`finalText ? 'llm' : 'stt'`) and updated error messages to specify which component failed

3. **Missing timeout configuration in logs**
   - **Problem:** Logs didn't show what timeout was configured, making it hard to know if timeouts were too aggressive
   - **Fix:** Added `timeoutMs` field to all request logs

## Key Learnings

- **Shared abort signal gotcha:** Both STT and LLM use the same `sttAbort.signal`, which means aborting one can affect the other. The logging now makes this visible.

- **Default timeouts are tight:** Both STT and LLM have 25-second timeouts by default (`STT_DEFAULT_TIMEOUT_MS`, `LLM_DEFAULT_TIMEOUT_MS`). Baseten's Qwen model is likely hitting this limit.

- **Error attribution is critical:** Without explicit stage tracking, errors were misleading. The `finalText` check provides a simple but effective way to determine failure point.

- **AbortError ambiguity:** An `AbortError` can mean either a timeout or an external abort. Added `reason` field to logs to distinguish these cases.

## Architecture Decisions

- **JSON-only logging:** Used `console.log(JSON.stringify(...))` instead of structured logging library to keep dependencies minimal and output parseable

- **Timing at call site:** Added timing measurements in the WebSocket handler rather than within provider functions to capture full end-to-end duration including any orchestration overhead

- **Separate abort logging:** Added explicit abort logs in provider timeout handlers rather than only catching in error handler, providing more precise failure point identification

## Ready for Next Session

- ✅ **Diagnostic capabilities** - Can now instantly identify if Groq or Baseten is causing timeouts
- ✅ **Quick fixes documented** - DEBUG.md includes commands to adjust timeouts or switch providers
- 🔧 **Needs investigation** - Once logs confirm Baseten timeouts, may need to increase `LLM_TIMEOUT_MS` or switch to faster LLM provider

## Context for Future

This logging infrastructure enables data-driven reliability improvements. The next step is to run the debug script during real usage, confirm which component is timing out (likely Baseten LLM based on the 25-second timeout), and either increase timeouts or switch to a faster LLM provider. The structured logs also provide foundation for metrics/observability dashboards if needed later.

The debug script pattern (`npm run dev:ws 2>&1 | ./worker/debug-logs.sh`) can be extended to filter or visualize other aspects of the pipeline as new issues emerge.
