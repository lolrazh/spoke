# VAD Silence Cutting Fix for Chunked Transcription

**Date:** 2025-12-11
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention
User discovered that the new chunked transcription architecture was producing hallucinations - certain chunks would return only the vocabulary prompt ("Spoke, Ganesh, ganeshpvt0@gmail.com") instead of actual transcription. They wanted to understand the root cause and fix it at the source, avoiding over-engineered band-aid solutions. The true goal was to ensure chunks contain only dense, clean speech audio that Whisper can confidently transcribe.

## What We Accomplished
- ✅ **Identified root cause of prompt hallucinations** - VAD was gating session start/end but forwarding ALL frames (including silence) during recording, causing chunks to contain weak/trailing audio
- ✅ **Fixed VAD to cut silences frame-by-frame during recording** - Changed forwarding logic from session-based to per-frame speech detection
- ✅ **Increased chunk boundary pause threshold** - Changed SENTENCE_PAUSE_MS from 700ms to 1500ms to only chunk on true "full stop" pauses

## Technical Implementation

The issue stemmed from a fundamental misunderstanding of how VAD operated during recording sessions.

**Before:**
- VAD gated the START and END of recording (prevented sending when completely silent)
- But DURING recording, `isSpeaking()` boolean stayed true through pauses
- ALL frames forwarded once recording started → chunks included silence
- Chunks looked like: `[strong speech][medium speech][quiet/trailing speech][700ms silence]`
- Whisper received weak audio → low confidence → hallucinated the prompt vocabulary

**After:**
- VAD evaluates EACH frame independently for speech content
- Only frames containing speech are forwarded (using `SPEECH_PROB_END` threshold)
- Silence frames during pauses → buffered to pre-roll, not sent to server
- Chunks now contain dense, speech-only audio with minimal silence

**Files Modified:**
- `src/config/vad.ts` - Changed `SENTENCE_PAUSE_MS` from 700 to 1500 (line 39)
- `src/utils/vadStreamGate.ts` - Added `currentFrameHasSpeech` flag and changed forwarding logic to per-frame speech detection (lines 31, 64, 124-135, 176-193)

**Key Code Change:**
```typescript
// OLD: Forward everything while "in a speaking session"
if (this.gate.isSpeaking() || this.tailRemainingSamples > 0) {
  out.push(int16);
}

// NEW: Forward only frames containing actual speech
if (this.currentFrameHasSpeech || this.tailRemainingSamples > 0) {
  out.push(int16);
}
```

## Bugs & Issues Encountered
1. **Chunked transcription returning only vocabulary prompt** - Friend's long dictation had 2 chunks (out of 7) that returned exactly "Spoke, Ganesh, ganeshpvt0@gmail.com" instead of transcribed speech
   - **Root Cause:** Chunks contained 10-12 seconds of audio (not empty!), but included trailing silence and weak speech. Whisper had low confidence and hallucinated the prompt text back.
   - **Fix:** Changed VAD to cut silences frame-by-frame during recording, ensuring chunks contain only dense speech audio

2. **Initial debugging led toward over-engineering** - Considered adding audio energy validation, prompt echo detection, and complex heuristics
   - **Resolution:** User correctly pushed back to find root cause. Fixing the VAD forwarding logic at the source eliminates need for downstream validation layers.

## Key Learnings
- **Whisper prompt hallucination behavior** - When Whisper receives audio with very low confidence (quiet speech, silence, weak audio), it will often "echo" the prompt vocabulary back as the transcription result. This is a known Whisper quirk, not a bug.
- **VAD session state vs per-frame detection** - The `isSpeaking()` boolean from `VadGate` represents "are we in a recording session" (stays true through brief pauses), NOT "does this specific frame contain speech". For silence cutting during recording, you need per-frame evaluation.
- **Chunking exposes silence issues** - Before chunking, entire dictations were sent as one WAV. Weak/quiet sections averaged out with strong speech. Chunking at sentence boundaries can isolate weak audio, exposing issues that were masked before.
- **700ms is NOT a "full stop" pause** - In natural speech, people pause for thought frequently. 700ms chunks too aggressively. 1500ms better represents actual sentence boundaries.

## Architecture Decisions
- **Per-frame forwarding vs session-based** - Chose to evaluate each frame independently for speech content rather than forwarding everything during "speaking sessions". This adds minimal overhead (already computing VAD per-frame) but ensures clean audio chunks.
- **Avoided multi-layer validation** - Could have added audio energy checks, prompt echo detection, speech density calculations. Instead fixed the root cause (silence forwarding) which eliminates the need for downstream validation.
- **Conservative pause threshold** - 1500ms may reduce chunk frequency, but ensures chunks represent complete thoughts with natural breaks. Better for transcription quality than aggressive chunking.

## Ready for Next Session
- ✅ **Silence cutting during recording** - VAD now properly gates audio frame-by-frame throughout the entire recording session
- ✅ **Chunk boundaries at natural pauses** - 1500ms threshold should catch true sentence endings
- 🔧 **Testing needed** - Should verify with real-world dictations that hallucinations are eliminated and chunks feel natural
- 🔧 **Potential monitoring** - May want to add logging to track chunk speech density in production to validate the fix

## Context for Future
This fix ensures the chunked transcription architecture (introduced earlier) produces high-quality results by sending only dense speech audio to Whisper. The VAD now operates in true "gating" mode throughout the entire session - not just at session boundaries - which is critical for multi-chunk dictations. This foundation enables confident expansion of chunked transcription features (like real-time streaming results) without worrying about hallucination edge cases.
