# Simplismart AI Provider Integration (STT + LLM)

**Date:** 2025-12-18
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention
User wanted to integrate Simplismart AI as a new provider for both speech-to-text (STT) and language model (LLM) capabilities in the Spoke worker. The goal was to add Simplismart alongside existing providers (Groq, Fireworks, Deepgram for STT; Groq, OpenAI, Baseten, OpenRouter, Cerebras for LLM) following the established architecture patterns. This provides more provider flexibility and allows testing Simplismart's Whisper implementation for transcription and Gemma-3 model for text refinement.

## What We Accomplished
- ✅ **STT Provider Integration** - Created Simplismart STT provider with base64 audio encoding, VAD configuration, and OpenAI-compatible response parsing
- ✅ **LLM Provider Integration** - Created Simplismart LLM provider with streaming support, custom model UUID header, and OpenAI-compatible API format
- ✅ **Configuration Updates** - Added all necessary constants, type definitions, and runtime config parsing for both STT and LLM
- ✅ **WebSocket Handler Updates** - Integrated API key bindings and provider routing in both transcription and chat completion flows
- ✅ **Bug Fixes** - Resolved base64 encoding stack overflow, fixed API request format, and corrected environment variable destructuring

## Technical Implementation

### STT Provider Pattern
The implementation followed the existing STT provider architecture with these key components:
- Base64 audio encoding in chunks (8KB) to avoid stack overflow
- Custom request body following Simplismart's API format with `audio_data` field
- Response parsing that joins `transcription` array into single text string
- VAD filter explicitly disabled per user requirements

### LLM Provider Pattern
The implementation followed the existing LLM provider architecture:
- Standard OpenAI-compatible chat completion format
- Custom `id` header containing model UUID (not per-request, but model identifier)
- Support for both streaming (SSE) and non-streaming responses
- Proper delta accumulation and `onDelta` callback handling

**Files Modified:**
- `worker/src/services/stt/providers/simplismart.ts` - New STT provider implementation
- `worker/src/services/llm/simplismart.ts` - New LLM provider implementation
- `worker/src/services/stt/index.ts` - Added Simplismart routing and default model
- `worker/src/services/llm/index.ts` - Added Simplismart routing
- `worker/src/config.ts` - Added endpoints, models, model UUID, and type definitions
- `worker/src/config/runtime.ts` - Added provider parsing and model mapping
- `worker/src/handlers/ws.ts` - Added API key bindings and environment destructuring

## Bugs & Issues Encountered

1. **Missing Environment Variable Destructuring**
   - **Symptom:** `SIMPLISMART_API_KEY is not defined` error at runtime
   - **Root Cause:** API key was added to Bindings type but not destructured from `c.env`
   - **Fix:** Added `SIMPLISMART_API_KEY` to destructuring statement on line 165 of ws.ts

2. **Wrong API Field Name**
   - **Symptom:** 400 validation error: "Field 'audio_data' required"
   - **Root Cause:** Used `audio_file` instead of `audio_data` based on initial curl example
   - **Fix:** Changed field name to `audio_data` to match actual API spec from docs

3. **Base64 Encoding Stack Overflow**
   - **Symptom:** "Maximum call stack size exceeded" error during transcription
   - **Root Cause:** `btoa(String.fromCharCode(...wav))` spread operator trying to pass 50,000+ bytes as individual function arguments
   - **Fix:** Process Uint8Array in 8KB chunks using subarray and loop:
   ```typescript
   const chunkSize = 8192;
   let binaryString = '';
   for (let i = 0; i < wav.length; i += chunkSize) {
     const chunk = wav.subarray(i, Math.min(i + chunkSize, wav.length));
     binaryString += String.fromCharCode(...chunk);
   }
   const base64Audio = btoa(binaryString);
   ```

## Key Learnings

- **Provider Integration Pattern**: Both STT and LLM follow identical integration patterns:
  1. Create provider file exporting standard interface function
  2. Add to dispatcher with if-else routing
  3. Update config constants and types
  4. Add to runtime parser
  5. Wire up environment bindings in WebSocket handler

- **Base64 Encoding Limits**: JavaScript's `String.fromCharCode(...array)` has argument count limits (~65k on most runtimes). For large binary data like audio, always chunk the conversion.

- **API Documentation Discrepancy**: User-provided curl example had different field name (`audio_file`) than actual API docs required (`audio_data`). Always verify against official docs when integration fails.

- **Model UUID Header**: Simplismart's `id` header is for the model UUID (identifies which model to use), not a per-request trace ID. This is a fixed value per model.

- **VAD Configuration**: Simplismart requires explicit VAD settings; user wanted `vad_filter: false` for their use case.

## Architecture Decisions

- **Chunked Base64 Encoding**: Chose 8KB chunk size as a balance between loop iterations and safety margin below stack limits. Could be tuned up to ~32KB on most platforms.

- **No Provider Abstraction**: Deliberately maintained simple if-else dispatch pattern instead of factory/strategy pattern. This keeps the codebase easy to understand and modify for future providers.

- **Separate Edit Models**: Followed existing pattern of having separate model constants for edit operations vs regular LLM operations, even though Simplismart uses the same model for both.

## Ready for Next Session

- ✅ **STT Integration Tested** - Simplismart transcription working in production
- ✅ **LLM Integration Tested** - Simplismart chat completion working with streaming
- ✅ **Default Provider Set** - Config updated to use Simplismart as default for both STT and LLM
- 🔧 **OCR Integration Pending** - User mentioned OCR as next integration target (same Simplismart provider pattern)

## Context for Future

This work establishes Simplismart as a fully integrated provider alongside existing options, giving the user flexibility to switch providers via environment variables. The integration follows the proven architectural patterns, making it easy to add more providers in the future. OCR integration will likely follow the same pattern as STT/LLM (create provider file, add to dispatcher, update config, wire environment). The rebased branch is ready to merge once user completes their testing.
