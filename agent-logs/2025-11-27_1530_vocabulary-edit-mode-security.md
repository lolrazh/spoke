# Vocabulary Edit Mode Fix and Native Helper Security

**Date:** 2025-11-27
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention
User identified that vocabulary (including user's name and custom terms) was being passed to the LLM during dictation mode post-processing but was completely missing in edit mode, causing the LLM to not recognize user-specific terms. Additionally, they discovered a security vulnerability where the native helper was logging selected text and surrounding context to stdout, potentially exposing passwords and PII in application logs.

## What We Accomplished
- ✅ **Edit mode vocabulary integration** - Modified `buildEditSystemPrompt()` to accept and inject vocabulary, bringing it to parity with dictation mode
- ✅ **Native helper privacy fix** - Wrapped all sensitive text logging behind a debug flag (`SF_NATIVE_DEBUG_TEXT`) that's disabled by default in production
- ✅ **Consistent vocabulary handling** - Edit mode now receives the same vocabulary awareness (name, email, custom vocab) as dictation mode

## Technical Implementation

### Vocabulary Fix
The issue was a mismatch between how dictation mode and edit mode handled vocabulary:

**Dictation mode** (working correctly):
```typescript
// Line 520 in ws.ts
systemPrompt: buildLLMSystemPrompt({ model, currentDate: runtime.llm.currentDate, sttPrompt })
```

**Edit mode** (broken):
```typescript
// Line 397 in ws.ts (before fix)
systemPrompt: buildEditSystemPrompt() // No vocabulary!
```

**Solution:**
1. Updated `buildEditSystemPrompt()` to accept optional `sttPrompt` parameter (matching dictation mode pattern)
2. Added `<vocabulary>` section to edit system prompt with same injection logic
3. Passed `sttPrompt` when calling `buildEditSystemPrompt({ sttPrompt })` in edit mode

### Security Fix
The native helper's `inspect_text_core()` function was unconditionally logging:
- Selected text (truncated and base64-encoded)
- Surrounding context (truncated and base64-encoded)

**Solution:**
1. Added `g_debug_text` global flag (disabled by default)
2. Added `SF_NATIVE_DEBUG_TEXT` environment variable check in `main()`
3. Wrapped sensitive `print_cfstring_*()` calls in `if (g_debug_text)` conditional
4. Preserved metadata logging (ranges, lengths, status) for production diagnostics

**Files Modified:**
- `worker/src/services/llm/editPrompt.ts` - Updated `buildEditSystemPrompt()` to accept and inject vocabulary
- `worker/src/handlers/ws.ts` - Pass `sttPrompt` to edit mode LLM call (line 397)
- `native/sonic-helper.c` - Added debug flag for sensitive text logging

## Bugs & Issues Encountered

1. **Vocabulary completely missing in edit mode**
   - **Symptom:** Edit mode couldn't recognize user's name or custom vocabulary terms
   - **Root cause:** `buildEditSystemPrompt()` was called with no parameters, unlike `buildLLMSystemPrompt()` which received `sttPrompt`
   - **Fix:** Added optional parameter to `buildEditSystemPrompt()` and passed vocabulary from `sttPrompt` built earlier in the flow

2. **Native helper logging PII to stdout**
   - **Symptom:** Selected text and context printed to logs in production, exposing sensitive data
   - **Root cause:** No conditional check on `print_cfstring_truncated()` and `print_cfstring_base64()` calls
   - **Fix:** Wrapped in `if (g_debug_text)` conditional, disabled by default

3. **Build failure on Linux**
   - **Symptom:** Native helper build script failed with `-fobjc-arc` error
   - **Root cause:** Build script requires macOS/Xcode toolchain, we're on Linux
   - **Workaround:** Skipped rebuild; binary will be recompiled automatically on macOS during next build/package

## Key Learnings

- **Vocabulary injection pattern:** Both dictation and edit modes share the same vocabulary building logic (`buildSTTPrompt`) but it needs to be explicitly passed to each system prompt builder
- **Privacy-first logging:** Following the existing pattern (`SF_NATIVE_DEBUG_KEYS`), sensitive logging should always be behind opt-in environment flags
- **Edit vs dictation modes:** Edit mode uses a different system prompt (`buildEditSystemPrompt`) focused on instruction-following rather than ASR cleaning, but still needs vocabulary awareness
- **Native helper architecture:** Text inspection happens in `inspect_text_core()` which uses AX API to read selected text and context; this is where sensitive data exposure occurred

## Architecture Decisions

- **Reused existing debug pattern:** Used `SF_NATIVE_DEBUG_*` environment variable pattern for consistency with `SF_NATIVE_DEBUG_KEYS`
- **Preserved metadata logging:** Kept non-sensitive logs (ranges, lengths, status) in production for debugging without exposing user content
- **Vocabulary injection via system prompt:** Maintains consistency with dictation mode by injecting vocabulary in the `<vocabulary>` XML tags section

## Ready for Next Session

- ✅ **Edit mode vocabulary parity** - Edit and dictation modes now have identical vocabulary awareness
- ✅ **Production privacy compliance** - No sensitive text logged unless explicitly enabled for debugging
- ✅ **Clean git history** - Two focused commits on feature branch `claude/fix-vocabulary-edit-mode-01GdmYn5K8nvYohNSZJRv2WE`
- 🔧 **Binary rebuild needed** - Native helper binary needs rebuild on macOS (will happen automatically during next package)

## Context for Future

This work ensures edit mode has full vocabulary awareness for accurate handling of user-specific terms (especially important for name corrections and custom vocabulary). The security fix prevents PII exposure in logs, which is critical for privacy compliance. Both changes follow existing patterns in the codebase (vocabulary injection, debug flags) making them maintainable and consistent with the architecture. Future work on LLM prompts (edit or dictation) should ensure vocabulary is always passed via the `sttPrompt` parameter.
