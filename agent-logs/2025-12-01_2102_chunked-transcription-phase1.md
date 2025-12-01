# Chunked Transcription - Phase 1: Detection Simulation

**Date:** 2025-12-01 21:02
**Session Goal:** Implement chunk boundary detection for incremental transcription, simulation mode only (logs, no actual chunking yet).

---

## User Intention

The user wants to implement chunked transcription to:
1. **Save money** - Groq bills 10-second minimum, so chunks of ~8-10s are optimal
2. **Get faster responses** - Shorter audio = faster transcription
3. **Improve accuracy** - Long dictations (30s+) produce degraded quality

Key constraints:
- Only chunk on **natural sentence pauses** (600-800ms of silence)
- **Never force-chunk** mid-sentence (that would ruin the experience)
- Minimum chunk duration of ~8s (to avoid over-billing)
- Phase 1 is **simulation only** - just log when chunks would be created

---

## What We Built

### New Files

- [x] `src/utils/chunkDetector.ts` - Chunk boundary detection logic
  - Watches VAD decisions (speech probability)
  - Detects sentence-ending pauses (≥700ms of low speech probability)
  - Only triggers chunk if audio ≥8000ms accumulated
  - Emits `chunk_boundary` events with timing info

### Modified Files

- [x] `src/config/vad.ts` - Added chunking configuration constants:
  - `CHUNK_DETECTION_ENABLED = true` - Feature flag for Phase 1
  - `MIN_CHUNK_AUDIO_MS = 8000` - Minimum audio before considering chunk
  - `SENTENCE_PAUSE_MS = 700` - Silence duration for sentence boundary
  - `CHUNK_SILENCE_PROB = 0.3` - VAD threshold for "silence"

- [x] `src/utils/vadStreamGate.ts` - Integrated chunk detector:
  - Added `ChunkDetector` instance alongside existing `VadGate`
  - Feeds same VAD decisions to chunk detector
  - New callback `onChunkEvent` for chunk boundary notifications
  - Added `getChunkState()` and `getRemainingChunk()` for debugging

- [x] `src/hooks/useTranscription.ts` - Wired up chunk event logging:
  - Chunk boundaries logged as `[SF] 🔪 CHUNK BOUNDARY {...}`
  - Final state logged as `[SF] 📦 FINAL CHUNK STATE {...}`

---

## How It Works

```
Audio: ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░▓▓▓▓
       │                  │     │               │     │
       │    ~10s audio    │700ms│   ~8s audio   │700ms│
       │                  │pause│               │pause│
       └──────────────────┴─────┘               │     │
            Chunk 0 logged here                 │     │
                                                │     │
       └────────────────────────────────────────┴─────┘
                               Chunk 1 logged here

       └────────────────────────────────────────────────┘
                    Final chunk state on PTT release
```

---

## Testing Instructions

1. Run the app: `npm run dev`
2. Open DevTools console
3. Start a long dictation (15-30 seconds)
4. Pause naturally between sentences (at least 700ms)
5. Watch for logs:
   - `[SF] 🔪 CHUNK BOUNDARY` - When a chunk boundary is detected
   - `[SF] 📦 FINAL CHUNK STATE` - When dictation ends (shows remaining audio)

### Expected Console Output

```
[SF] 🔪 CHUNK BOUNDARY {
  chunkIndex: 0,
  audioMs: 10230,      // ~10s of audio in this chunk
  silenceMs: 720,      // 720ms of silence triggered the boundary
  totalAudioMs: 10230, // Total audio since start
  atMs: 10230          // Timestamp
}

[SF] 📦 FINAL CHUNK STATE {
  remainingChunk: { audioMs: 5420, chunkIndex: 1 },
  chunkState: { ... }
}
```

---

## Key Decisions

1. **No forced chunking** - Only natural pauses trigger chunks. If someone speaks continuously for 30 seconds without pausing, we send all 30s at once.

2. **Chunk detection runs in parallel** with existing VAD gate - The gate still handles speech_start/speech_end events for audio forwarding; chunk detector just observes.

3. **700ms silence threshold** - This is the "full stop" pause. Shorter pauses (200-400ms) are treated as "comma" pauses and don't trigger chunking.

4. **8000ms minimum chunk** - Groq bills 10s minimum, so anything <8s would waste money. We don't chunk very short utterances.

---

## Next Steps (Phase 2)

1. **Add protocol support** - New `"chunk"` message type for client→server
2. **Accumulate audio buffers per chunk** - Track which frames belong to which chunk
3. **Server-side parallel STT** - Start transcribing chunks as they arrive
4. **Result concatenation** - Assemble chunk results in order on `"end"`

---

## Architecture Notes for Phase 2

```typescript
// New state to track
const chunkBuffersRef = useRef<Map<number, ArrayBuffer[]>>();
const chunkResultsRef = useRef<Map<number, string>>();

// On chunk_boundary:
// 1. Mark current chunk as "ready to send"
// 2. Send accumulated audio + { type: "chunk", chunkIndex: N }
// 3. Start new buffer for next chunk

// On PTT release:
// 1. Send any remaining audio as final chunk
// 2. Send { type: "end" }
// 3. Wait for all chunk results
// 4. Concatenate in order
// 5. Optional: single LLM pass for cleanup
```

---

**Files Modified:**
- `src/config/vad.ts`
- `src/utils/chunkDetector.ts` (new)
- `src/utils/vadStreamGate.ts`
- `src/hooks/useTranscription.ts`
