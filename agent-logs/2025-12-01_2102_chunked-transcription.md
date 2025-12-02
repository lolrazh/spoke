# Chunked Transcription - Full Implementation with Metrics

**Date:** 2025-12-01 21:02 (updated)
**Session Goal:** Implement chunked transcription for faster responses and better handling of long dictations.

---

## User Intention

The user wants chunked transcription to:
1. **Save money** - Groq bills 10-second minimum, so chunks of ~8-10s are optimal
2. **Get faster responses** - Shorter audio = faster transcription
3. **Improve accuracy** - Long dictations (30s+) produce degraded quality

Key constraints:
- Only chunk on **natural sentence pauses** (600-800ms of silence)
- **Never force-chunk** mid-sentence
- Minimum chunk duration of ~8s (to optimize billing)

---

## What We Built

### Phase 1: Chunk Detection ✅

- [x] `src/config/vad.ts` - Added chunking config constants
- [x] `src/utils/chunkDetector.ts` - Chunk boundary detection logic
- [x] `src/utils/vadStreamGate.ts` - Integrated chunk detector
- [x] `src/hooks/useTranscription.ts` - Chunk event logging

### Phase 2: Full Implementation ✅

#### Protocol Changes
- [x] `worker/src/types/messages.ts` - Added `ClientChunkMessage` and `ServerChunkResultMessage`
- [x] `src/types/protocol.ts` - Added `ClientChunk` and `ServerChunkResult`
- [x] `worker/src/ws/session.ts` - Added `ChunkState` type and chunk tracking in session

#### Client Changes
- [x] `src/hooks/useTranscription.ts`:
  - Added `chunkResultsRef`, `pendingChunksRef`, `currentChunkIndexRef` for state tracking
  - Chunk event handler now sends `{ type: "chunk", chunkIndex, audioMs }` to worker
  - Added `chunk_result` message handler for progressive UI updates
  - Reset chunk state on session start

#### Worker Changes
- [x] `worker/src/handlers/ws.ts`:
  - Added `chunk` message handler that:
    - Takes snapshot of accumulated audio
    - Starts STT immediately (async, non-blocking)
    - Clears buffer for next chunk
    - Sends `chunk_result` when STT completes
  - Updated `end` handler to:
    - Wait for pending chunk STTs (15s timeout)
    - Collect chunk results in order
    - Process remaining audio (final chunk)
    - Concatenate all texts
    - Continue with optional LLM post-processing

---

## How It Works

```
Time: 0s──────10s────────20s──────────[PTT up]
      │        │          │           │
Audio:▓▓▓▓▓▓▓▓░░▓▓▓▓▓▓▓▓▓░░▓▓▓▓▓▓▓▓▓▓▓▓
      │      │ │        │ │           │
      │      │ │        │ │           │
      └──────┴─┘        │ │           │
       Chunk 0          │ │           │
       (700ms pause)    │ │           │
       → STT starts     │ │           │
       immediately      └─┴───────────┘
                        Chunk 1
                        (700ms pause)
                        → STT starts
                        immediately

       [Chunk 0 result arrives while still speaking!]
       [Chunk 1 result arrives]
       [PTT up → process remaining audio → final assembly]
```

### Console Logs You'll See

```
[SF] 🔪 CHUNK BOUNDARY { chunkIndex: 0, audioMs: 10230, silenceMs: 720 }
[SF] 📤 Sent chunk message { type: "chunk", chunkIndex: 0, audioMs: 10230 }

// Later:
[SF] 📥 Chunk result received { chunkIndex: 0, textLength: 42, pendingCount: 0 }

// On PTT release:
[SF] 📦 FINAL CHUNK STATE { remainingChunk: { audioMs: 5420, chunkIndex: 1 } }
```

---

## Configuration

In `src/config/vad.ts`:

```typescript
CHUNK_DETECTION_ENABLED = true   // Enable chunking
MIN_CHUNK_AUDIO_MS = 8000        // Minimum audio before chunking (8s)
SENTENCE_PAUSE_MS = 700          // Silence for sentence boundary (700ms)
CHUNK_SILENCE_PROB = 0.3         // VAD threshold for "silence"
```

---

## Testing Instructions

1. Start the worker: `npm run dev:ws` (in worker/)
2. Start the app: `npm run dev:local`
3. Open DevTools console
4. Record a long dictation (15-30 seconds)
5. Pause naturally between sentences (~1 second)
6. Watch for:
   - `🔪 CHUNK BOUNDARY` - Chunk detected
   - `📤 Sent chunk message` - Chunk sent to worker
   - `📥 Chunk result received` - Result back from worker
   - Progressive text updates in the UI!

---

## Architecture Notes

### Why This Design?

1. **Client controls chunking** - Uses existing VAD (Silero) to detect sentence pauses
2. **Worker runs STT in parallel** - Each chunk is transcribed independently
3. **Results arrive progressively** - User sees partial text while still speaking
4. **Final assembly on 'end'** - All chunks concatenated in order, then optional LLM pass

### Trade-offs

- **Slightly more complex state management** - But worth it for the UX improvement
- **Multiple STT calls** - But each is faster, and Groq bills 10s minimum anyway
- **Sentence boundary detection** - May occasionally chunk mid-thought, but the 700ms threshold is quite conservative

---

## Files Modified

### Client
- `src/config/vad.ts` - Chunking config
- `src/utils/chunkDetector.ts` - **NEW** - Detection logic
- `src/utils/vadStreamGate.ts` - Chunk detector integration
- `src/hooks/useTranscription.ts` - Chunk send/receive handling
- `src/types/protocol.ts` - Protocol types

### Worker
- `worker/src/types/messages.ts` - Protocol types
- `worker/src/ws/session.ts` - Chunk state tracking
- `worker/src/handlers/ws.ts` - Chunk/end message handling
