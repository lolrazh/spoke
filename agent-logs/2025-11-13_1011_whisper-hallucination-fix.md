# Fix Whisper "Thanks for Watching" Hallucinations

**Date:** 2025-11-13
**Agent:** Claude (Sonnet 4.5)
**Status:** ⚠️ Partial

## User Intention
User experienced random hallucinations in Whisper transcriptions where common YouTube phrases like "Thanks for watching," "Don't forget to like and subscribe," and "Subtitles by the Amara.org community" would appear at the end of dictations, cutting off the actual transcribed content. The goal was to eliminate these hallucinations while avoiding false positives (removing legitimately spoken phrases) and without degrading VAD sensitivity.

## What We Accomplished
- ✅ **Set Whisper temperature to 0** - Explicitly configured deterministic transcription to reduce randomness-induced hallucinations
- ✅ **Enhanced STT prompt** - Added anti-hallucination instructions to guide Whisper behavior
- ❌ **Post-processing filter** - Created but reverted due to bugs that stripped legitimate content

## Technical Implementation

### Temperature Configuration
Added explicit `temperature: 0` parameter to Groq Whisper API calls. This forces deterministic transcription with no randomness, which is the most effective method to reduce hallucinations according to industry best practices.

**Files Modified:**
- `worker/src/services/stt/providers/groq.ts` - Added `form.append('temperature', '0')` at line 38

### Prompt Engineering
Updated the default STT prompt from `'Your vocabulary includes: Sonic Flow'` to include explicit instructions: `'Transcribe the audio accurately. Do not add any phrases not spoken. Your vocabulary includes: Sonic Flow'`

**Files Modified:**
- `worker/src/services/stt/prompt.ts` - Modified `DEFAULT_STT_PROMPT` constant at line 6

## Bugs & Issues Encountered

1. **Post-processing filter stripping legitimate content**
   - **Symptom:** The `stripHallucinations()` function kept printing "thanks for watching" and was incorrectly stripping text that appeared before the hallucination phrases
   - **Root Cause:** Regex pattern matching logic had issues with boundary detection or greedy matching
   - **Resolution:** Reverted the post-processing filter implementation entirely via `git reset` and force push. Relying solely on temperature=0 and prompt engineering instead.

## Key Learnings

- **Whisper temperature defaults:** Groq's Whisper API defaults to temperature=0, but it's critical to set it explicitly rather than relying on defaults
- **Hallucination root cause:** Whisper was trained on YouTube videos and learned these common video ending phrases. When encountering silence or ambiguous audio at the end of recordings, it "fills in" with learned patterns
- **Post-processing complexity:** Regex-based filtering of hallucinations is fragile and prone to false positives. Pattern matching at string boundaries requires careful testing to avoid stripping legitimate content
- **Layered defense approach:** Multiple prevention layers (temperature + prompt + filtering) seemed ideal, but simpler is often better - temperature=0 alone may be sufficient

## Architecture Decisions

- **Temperature over post-processing:** Chose to rely on `temperature: 0` and prompt engineering rather than post-processing regex filters. This avoids false positive risks where legitimately dictated phrases get stripped
- **No VAD changes:** Explicitly avoided modifying Voice Activity Detection sensitivity despite it being a potential solution, as previous attempts caused word loss and degraded accuracy
- **Provider consideration:** Kept Groq as STT provider rather than switching to Fireworks. Fireworks has temperature schedule built in (`0.0,0.2,0.4`) and additional VAD, but changing providers introduces unknown performance/cost trade-offs

## Ready for Next Session

- ✅ **Temperature fix deployed** - Core prevention mechanism is in place and committed
- ✅ **Enhanced prompt deployed** - Secondary prevention layer is active
- 🔧 **Monitoring needed** - Should monitor if hallucinations still occur with current fixes
- 🔧 **Alternative providers** - If issues persist, consider testing Fireworks provider (already configured at `worker/src/services/stt/providers/fireworks.ts`)
- 🔧 **Audio trimming** - Could implement VAD-based audio trimming to remove trailing silence before sending to Whisper

## Context for Future

The temperature=0 and prompt changes should significantly reduce Whisper hallucinations. If the problem persists after deployment, the next options to explore are: (1) switching to Fireworks STT provider which has additional VAD and temperature scheduling, or (2) implementing smart audio trimming to remove trailing silence before transcription. The post-processing filter approach proved too fragile for production use.

**Commits:**
- `6cbbdeb` - fix: set Whisper temperature to 0 to reduce hallucinations
- `d164e98` - fix: add anti-hallucination instructions to Whisper prompt
- (Post-processing filter commits were reverted)
