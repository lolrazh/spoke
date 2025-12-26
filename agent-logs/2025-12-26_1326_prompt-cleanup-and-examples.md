# Prompt System Cleanup and Example Fixes

**Date:** 2025-12-26
**Agent:** Claude Opus 4.5 (cleanup), Claude Sonnet 4.5 (initial implementation)
**Status:** ✅ Completed

## User Intention

User switched from Sonnet to Opus after being frustrated with Sonnet's over-complicated implementation of the consolidated prompt system. The core issue: Sonnet created 17 unnecessary files, left dead code everywhere, wrote broken examples that dropped content or didn't demonstrate features properly, and kept suggesting FSTs/ML classifiers when simple regex was sufficient. User wanted production-ready code with proper examples, no dead code, and no over-engineering.

## What We Accomplished

- ✅ **Deleted 17 dead files/directories** - Removed backup dirs, old prompt files, unused re-exports
- ✅ **Fixed all prompt examples** - Symbols, casing, and quotes now properly demonstrate each feature
- ✅ **Removed confusing "reverse order" rule** - Legacy instruction from old monolithic prompt
- ✅ **Fixed TypeScript compilation** - Properly typed TRIGGER_RULES and TRIGGER_EXAMPLES
- ✅ **Cleaned up dead imports** - Removed unused imports from ws.ts and all provider files
- ✅ **All 155 tests passing** - No regressions introduced

## Technical Implementation

### Files Deleted (17 total)
```
worker/src/services/llm/
├── prompts-backup-2025-12-26/       # Sonnet's unnecessary backup (10 files)
├── OLD_MONOLITHIC_PROMPT_BACKUP.ts  # Duplicate backup
├── prompt.ts + prompt.test.ts       # Old monolithic prompt (replaced)
├── routing.ts + routing.test.ts     # Old routing (replaced by smartRouting)
└── prompts/                         # Unnecessary nested directory
    ├── base.ts, spelling.ts, symbols.ts, casing.ts
    ├── quotes.ts, corrections.ts, lists.ts
    ├── index.ts, composer.ts        # Re-export layers (pointless)
    └── composer.test.ts             # Moved to prompts.test.ts
```

### Final Clean Structure
```
worker/src/services/llm/
├── prompts.ts              # Single source of truth for all prompts
├── prompts.test.ts         # Consolidated tests
├── triggers.ts             # Trigger detection
├── smartRouting.ts         # 4-tier routing
├── [provider files].ts     # groq, openai, baseten, etc.
└── index.ts                # Provider dispatcher
```

### Example Fixes

**Before (Sonnet's broken symbol example):**
```typescript
user: 'Look mom, no hands. Tag mom with an ad symbol and show excitement.'
assistant: 'Look mom, no hands! @mom'  // ❌ "show excitement" completely dropped
```

**After (fixed):**
```typescript
user: 'Look mom, no hands! Put an ad symbol before mom and add a party emoji.'
assistant: 'Look @mom, no hands! 🎉'  // ✅ All content preserved, typo "ad symbol" intentional
```

**Casing - Before:**
```typescript
user: 'The acronym is D-N-A, in all caps.'
assistant: 'The acronym is DNA.'
```
Problem: DNA is naturally uppercase anyway, doesn't demonstrate the "in caps" feature, also triggers spelling.

**Casing - After:**
```typescript
{
  user: 'The password is secret. Make that all caps.',
  assistant: 'THE PASSWORD IS SECRET.',
},
{
  user: 'Hey, What\'s up? What\'s going on? Write that in lowercase.',
  assistant: 'hey, what\'s up? what\'s going on?',
}
```

**Quotes - Added:**
```typescript
{
  user: 'I mean they said I was quote-unquote lucky to be here. What the fuck do they mean by that?',
  assistant: 'I mean they said I was "lucky" to be here. What the fuck do they mean by that?',
},
{
  user: 'She literally said quote I don\'t care about your feelings end quote. Can you believe that?',
  assistant: 'She literally said "I don\'t care about your feelings." Can you believe that?',
}
```

### TypeScript Fixes

**Problem:** `Object.entries()` returns `string` keys, but `triggers.has()` expects `TriggerType`

```typescript
// Before (compile error)
for (const [triggerName, ruleText] of Object.entries(TRIGGER_RULES)) {
  if (triggers.has(triggerName)) {  // ❌ string not assignable to TriggerType
    rules.push(ruleText);
  }
}

// After (fixed)
import type { TriggerContext, TriggerType } from './triggers';

const TRIGGER_RULES: Record<TriggerType, string> = { /* ... */ };
const TRIGGER_EXAMPLES: Record<TriggerType, Array<{ user: string; assistant: string }>> = { /* ... */ };

for (const [triggerName, ruleText] of Object.entries(TRIGGER_RULES)) {
  if (triggers.has(triggerName as TriggerType)) {  // ✅ Type assertion
    rules.push(ruleText);
  }
}
```

### Dead Import Cleanup

**ws.ts before:**
```typescript
import { selectLLMRoute } from '../services/llm/routing'; // DEPRECATED
import { buildLLMSystemPrompt } from '../services/llm/prompt'; // DEPRECATED
import { prepareEditRequest, buildEditSystemPrompt } from '../services/llm/editPrompt';
```

**ws.ts after:**
```typescript
import { prepareEditRequest, buildEditSystemPrompt } from '../services/llm/editPrompt';
```

**Provider files (groq, openai, baseten, cerebras, openrouter, simplismart) - before:**
```typescript
import { DEFAULT_LLM_SYSTEM_PROMPT } from './prompt';
// ...
systemPrompt = DEFAULT_LLM_SYSTEM_PROMPT,
```

**After:**
```typescript
// Import removed
systemPrompt = '',  // ws.ts always passes explicit prompt anyway
```

**Files Modified:**
- `worker/src/services/llm/prompts.ts` - Fixed examples, added TriggerType import, type assertions
- `worker/src/services/llm/prompts.test.ts` - Updated test expectations for new examples
- `worker/src/handlers/ws.ts` - Removed dead imports (selectLLMRoute, buildLLMSystemPrompt)
- `worker/src/services/llm/groq.ts` - Removed DEFAULT_LLM_SYSTEM_PROMPT import, empty string default
- `worker/src/services/llm/openai.ts` - Same as groq
- `worker/src/services/llm/baseten.ts` - Same as groq
- `worker/src/services/llm/cerebras.ts` - Same as groq
- `worker/src/services/llm/openrouter.ts` - Same as groq
- `worker/src/services/llm/simplismart.ts` - Same as groq

## Bugs & Issues Encountered

1. **TypeScript compilation errors on string → TriggerType**
   - **Symptom:** `Object.entries()` returns `[string, T][]` but `triggers.has()` expects `TriggerType`
   - **Fix:** Added type assertion `triggerName as TriggerType` in loops (lines 140, 160)

2. **Dead imports breaking provider tests**
   - **Symptom:** `import { DEFAULT_LLM_SYSTEM_PROMPT } from './prompt'` failed - file deleted
   - **Fix:** Removed imports from all 6 provider files, used empty string default (ws.ts always passes explicit prompt)

3. **Test expectations outdated after example changes**
   - **Symptom:** Tests looking for `@Groq` when examples now use `@mom`
   - **Fix:** Updated test assertions to match new examples (lines 36, 55, 83 in prompts.test.ts)

## Key Learnings

- **Don't over-engineer dictation triggers** - Regex keyword matching works fine for most cases. FSTs/ML classifiers are overkill when:
  - Spelling patterns are easy to detect: `S-P-O-K-E` or `S P O K E`
  - Users specifically say "spell", "quote", "uppercase" - unambiguous directives
  - False positives are rare in natural dictation flow

- **TypeScript Record keys lose type information** - `Object.entries<Record<K, V>>()` returns `[string, V][]` not `[K, V][]`. Need type assertions when iterating.

- **Examples should demonstrate the feature, not just pass tests** - Sonnet's examples:
  - Dropped content ("show excitement" vanished)
  - Triggered multiple features unintentionally (DNA = spelling + casing)
  - Didn't show edge cases or real usage

- **Intentional typos in examples are valuable** - "ad symbol" instead of "at symbol" teaches the LLM about common Whisper mistakes

- **Bypass tier quality concerns are addressed by STT prompt** - User confirmed:
  - Whisper already removes filler words via prompt engineering
  - OCR vocabulary is injected into STT, gets correct spellings
  - Punctuation/capitalization is 95% correct from Whisper
  - Trading 5% quality for <400ms latency is intentional

## Architecture Decisions

- **Single consolidated prompts.ts over modular files** - Sonnet split into 7 files (base, spelling, symbols, casing, quotes, corrections, lists) + 2 re-export layers. Unnecessary complexity for ~200 lines of rules/examples.

- **Keep "reverse order" rule removed** - Was legacy from old monolithic prompt's BODMAS-like parsing. Not relevant in new modular structure with dynamic composition.

- **No FST/ML for trigger detection** - User explicitly rejected:
  - Intent classifiers (50-200ms latency, needs training data, adds complexity)
  - FSTs for spelling (regex is sufficient)
  - N-gram models (overkill for clear verbal directives)
  - ITN layer for symbol normalization (would need Cloudflare Workers AI, adds 50-200ms)

- **Token estimation stays simple** - User confirmed `Math.ceil(prompt.length / 4)` is sufficient. Not for billing accuracy, just to detect when longer content needs smarter model. No need for tiktoken dependency.

## Ready for Next Session

- ✅ **Clean codebase** - All dead code removed, tests passing, TypeScript compiling
- ✅ **Production-ready examples** - All triggers have real-world examples that preserve content
- ✅ **Type-safe prompt system** - Proper use of TriggerType throughout
- 🔧 **Real-world testing needed** - Examples untested with actual LLM calls, only unit tests
- 🔧 **Potential trigger improvements** - Based on real usage, may need context-aware heuristics for disfluency detection (e.g., "sorry" in empathy vs correction)

## Context for Future

This cleanup establishes the final structure for the dynamic prompt system. The architecture is now production-ready: single consolidated file with proper examples, no dead code, type-safe. Next work should focus on real-world testing with live transcriptions to validate trigger detection accuracy and prompt effectiveness. If false positives emerge (e.g., "sorry" triggering disfluency when it shouldn't), consider adding context-aware validation to triggers.ts rather than jumping to ML/FST solutions.
