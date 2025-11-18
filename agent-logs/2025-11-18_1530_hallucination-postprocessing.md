# Hallucination Post-Processing Filter (Router Level)

**Date:** 2025-11-18
**Agent:** Claude (Sonnet 4.5)
**Status:** ✅ Completed

## User Intention
The "Thank you for watching!" hallucination issue returned in production despite previous fixes (temperature=0 and prompt engineering from 2025-11-13). User wanted to implement a robust post-processing filter that specifically targets this exact phrase at the end of transcriptions, applied at the router level rather than inside individual STT providers for cleaner architecture.

## What We Accomplished
- ✅ **Post-processing utility created** - Built `stripHallucinations()` function with targeted regex for end-of-text matching
- ✅ **Router-level integration** - Applied filter in `worker/src/services/stt/index.ts` after receiving results from any provider
- ✅ **Comprehensive test coverage** - Created test suite covering edge cases, false positives, and case variations
- ✅ **Refined case sensitivity** - User improved regex to only match "T/t" variations, not fully case-insensitive (more precise)

## Technical Implementation

### Post-Processing Filter
Created a focused utility function that removes "Thank you for watching!" only when it appears at the very end of transcriptions.

**Final Implementation (after user refinement):**
```typescript
// Pattern matches: "thank you for watching!" OR "Thank you for watching!"
// Does NOT match: "THANK YOU FOR WATCHING!" or "Thank You For Watching!"
const pattern = /[Tt]hank you for watching!$/;
```

**Files Created:**
- `worker/src/services/stt/postprocess.ts` - Core filter utility with documentation
- `worker/src/services/stt/postprocess.test.ts` - Test suite with 10+ test cases

### Router Integration
Applied filter at the orchestration layer (`index.ts`) rather than inside Groq provider. This ensures:
1. Single point of control for post-processing
2. Automatic coverage for all STT providers (Groq, Fireworks, Deepgram)
3. Cleaner separation of concerns (providers = API calls, router = business logic)

**Files Modified:**
- `worker/src/services/stt/index.ts` - Added `stripHallucinations()` call at line 80-83, applied to result.text before returning
- `worker/src/services/stt/providers/groq.ts` - Initially modified but later reverted to keep provider code clean

### Test Coverage
Comprehensive test suite includes:
- ✅ Removes phrase from end (lowercase "t" and uppercase "T")
- ✅ Handles hallucination-only input (returns empty string)
- ✅ Trims whitespace after removal
- ✅ Does NOT remove phrase from middle of text
- ✅ Does NOT remove similar phrases without exclamation mark
- ✅ Handles empty strings and whitespace-only input
- ✅ Does NOT match weird cases like "THANK YOU FOR WATCHING!"

## Bugs & Issues Encountered

1. **Initial over-engineering with telemetry tracking**
   - **Symptom:** First implementation tracked both `raw_text` and `transcription_text` in Sentry spans
   - **Fix:** User suggested router-level approach, eliminating need for dual tracking. Cleaner and simpler.

2. **Overly broad regex pattern**
   - **Symptom:** Initial implementation used `/thank you for watching!$/i` (fully case-insensitive)
   - **Fix:** User refined to `/[Tt]hank you for watching!$/` to only match realistic Whisper outputs (first letter variation only). More precise, fewer false positives.

## Key Learnings

- **Router vs Provider filtering:** Applying post-processing at the router level is architecturally superior. Providers stay focused on API communication, router handles all business logic transformations. This pattern scales better when supporting multiple STT backends.

- **Whisper case patterns:** Whisper typically outputs "thank you for watching!" (lowercase) or "Thank you for watching!" (sentence-case) but NOT "THANK YOU FOR WATCHING!" or "Thank You For Watching!". The refined regex `/[Tt]hank you for watching!$/` matches actual hallucination patterns while reducing false positive risk.

- **Temperature + Post-processing is necessary:** Despite setting temperature=0 in the previous session, hallucinations still occurred. This confirms that layered defense (temperature + prompt + filtering) is required for production reliability.

- **Regex anchor specificity:** Using `$` anchor ensures we only match at the end of strings. This prevents accidentally stripping "I want to say thank you for watching! this presentation" from the middle.

- **False positive tradeoff:** The filter will remove legitimately dictated "thank you for watching!" at the end. User accepted this tradeoff because the hallucination is more disruptive than the edge case of someone actually dictating this exact phrase.

## Architecture Decisions

- **Router-level filtering over provider-level:** Chose to apply `stripHallucinations()` in `index.ts` after receiving results from any provider, rather than inside each provider's implementation. This creates a single source of truth and automatically covers Groq, Fireworks, and Deepgram without code duplication.

- **Character class over case-insensitive flag:** Chose `/[Tt]hank you for watching!$/` over `/thank you for watching!$/i` to match only realistic Whisper outputs. The `i` flag would match "tHaNk YoU fOr WaTcHiNg!" which is unrealistic and could increase false positives if users dictate variations.

- **Post-processing over prevention:** Combined approach using both prevention (temperature=0, enhanced prompt) and post-processing (filter). Previous session relied only on prevention, but production data showed it's insufficient. Filter serves as safety net.

- **Simple trim-and-replace over complex parsing:** Avoided complex AST parsing or sentence tokenization. Simple regex match + replace is sufficient, maintainable, and performant.

## Ready for Next Session

- ✅ **Post-processing filter deployed** - `stripHallucinations()` function is production-ready with tests
- ✅ **Router integration complete** - Filter applies to all STT providers automatically
- ✅ **Case sensitivity refined** - Regex pattern matches realistic Whisper outputs only
- ✅ **Test coverage comprehensive** - Edge cases, false positives, and case variations covered
- 🔧 **Production monitoring needed** - Should track if hallucinations still occur or if filter creates new issues
- 🔧 **Consider expanding filter patterns** - If other hallucinations emerge (e.g., "Don't forget to subscribe"), can extend `stripHallucinations()` function

## Context for Future

This session successfully implemented the post-processing approach that was attempted and reverted in the previous session (2025-11-13). The key difference is architectural placement (router vs provider) and regex precision (character class vs case-insensitive flag). The hallucination issue has now been addressed with a three-layer defense: (1) temperature=0, (2) anti-hallucination prompt, and (3) post-processing filter. If hallucinations persist, the next step would be to switch STT providers to Fireworks (which has additional VAD and temperature scheduling) or implement VAD-based audio trimming to remove trailing silence before transcription.

**Commits:**
- `c800945` - fix: add robust post-processing filter for "Thank you for watching!" hallucination
- `cb45167` - refactor: move hallucination filter to router level
- `f8b2df3` - test: update stripHallucinations tests for case sensitivity (user contribution)

**References:**
- Building on `2025-11-13_1011_whisper-hallucination-fix.md` (previous attempt)
