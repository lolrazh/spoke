# Transcription Pipeline

Spoke's transcription pipeline transforms voice into text through real-time audio streaming, speech recognition, and optional LLM enhancement. The entire flow—from microphone to text insertion—happens in under 2 seconds.

**Related:** `docs/DATABASE.md`, `docs/INSTRUMENTATION.md`, `docs/DESIGN.md`

---

## Philosophy

The transcription pipeline is built on six principles:

1. **Speed**: Sub-1s end-to-end latency from release to paste, with JWKS edge caching and pre-connect optimization
2. **Flexibility**: Multiple STT/LLM providers (5 LLM, 3 STT), runtime-switchable via env vars
3. **Privacy**: No text stored in database, only local + ephemeral server processing
4. **Security**: JWT-based authentication with subscription/quota claims embedded, JWKS cached at edge
5. **Simplicity**: Single-shot audio processing (chunking removed 2025-12-12)
6. **Context-Awareness**: OCR-powered vocabulary extraction for improved transcription accuracy

The system supports two modes: **dictation** (voice → text) and **edit** (voice instruction → rewrite selected text). As of 2025-12-12, context-aware transcription uses on-screen content via OCR to improve proper noun accuracy.

Authentication happens once at WebSocket connection time—JWT claims provide instant entitlement gating (Pro subscription or free tier quota) with zero database queries during transcription. JWKS keys are cached at the edge (two-tier: in-memory + Cache API) for sub-50ms JWT verification.

---

## Pipeline Flow

<pipeline>
  <stage name="context" added="2025-12-12">
    PTT down → Screenshot capture (Electron desktopCapturer, ~293ms, JPEG quality 75)
  </stage>

  <stage name="capture">
    Microphone → getUserMedia() → 48kHz mono stream
  </stage>

  <stage name="process">
    AudioWorklet resamples to 16kHz PCM16, buffers into 100ms frames (1600 samples)
  </stage>

  <stage name="stream">
    WebSocket sends binary frames (16-byte headers: sequence, size, timestamp) + context_ocr message
  </stage>

  <stage name="ocr" added="2025-12-12">
    Worker OCR service (Groq Llama 4 Scout) extracts proper nouns from screenshot (fire-and-forget, ~800-1200ms)
  </stage>

  <stage name="transcribe">
    Cloudflare Worker concatenates PCM, wraps in WAV, calls STT API (Groq/Fireworks/Deepgram) with OCR-enriched vocabulary
  </stage>

  <stage name="enhance">
    LLM post-processing with OCR context (fuzzy matching for proper nouns, cleanup for dictation, rewrite for edit mode)
  </stage>

  <stage name="insert">
    Native helper (C binary) pastes text at cursor via macOS Accessibility API
  </stage>
</pipeline>

Each stage is optimized for low latency—audio worklet runs in dedicated thread, WebSocket uses binary protocol, OCR runs fire-and-forget (doesn't block audio), STT/LLM calls happen in parallel where possible.

---

## Authentication & Authorization

Spoke uses JWT-based authentication with embedded subscription and quota claims for instant entitlement gating.

<auth_flow>
  <connection_auth updated="2025-12-20">
    1. App starts → Supabase refreshes JWT (runs custom_access_token_hook in Postgres)
    2. Hook checks subscriptions table, reads quota from profiles table
    3. Hook implements lazy weekly reset (if quota_reset_date < NOW(), resets to 0, every Monday 00:00 UTC)
    4. Hook adds claims to JWT:
       - subscription_active (boolean) - Pro tier status
       - words_used_this_week (number) - Free tier usage (after reset if needed)
       - quota_limit (number) - Free tier limit (1000 words/week)
       - quota_reset_date (timestamp) - Next reset date
    5. App syncs quota from JWT to localStorage on startup (display-only cache)
    6. User presses PTT → App checks local quota first (instant feedback)
    7. If local quota exceeded → Show notification immediately, skip WebSocket connection
    8. If local quota OK → Recording starts IMMEDIATELY (parallel auth optimization)
    
    **Parallel Auth Flow (2025-12-20):**
    Recording and auth run in parallel for zero perceived latency:
    
    Thread 1 (Recording - IMMEDIATE):
      - setRecording(true) - frequency bars start moving
      - Initialize AudioContext and AudioWorklet
      - Start producing PCM frames
      - Frames queue in sendQueueRef (client-side buffer)
    
    Thread 2 (Auth - BACKGROUND):
      - Open WebSocket connection
      - Send 'auth' message with JWT
      - Worker verifies JWT signature using JWKS (Supabase public key)
      - Worker extracts claims from verified JWT
      - Worker checks entitlement (server-authoritative):
        * Pro users (subscription_active=true): Instant pass
        * Free users: Check quota (words_used >= quota_limit → BLOCK)
      - If auth passes: Worker sends 'auth_ok'
        * wsReadyRef.current = true
        * trySendStartMessage() sends 'start' message
        * flushQueue() sends buffered frames to worker
        * All future frames sent directly
      - If auth fails: Worker closes connection with error code (4020 or 4021)
        * Recording stops
        * Buffered frames cleared
        * Error notification shown
    
    **Latency Impact:**
    - Typical case (90%+): Auth completes in 10-50ms (JWKS cached)
      * User never perceives delay (auth finishes before first word)
      * ~3-5 frames queued before auth completes
    - Cold start case (<10%): Auth completes in 500ms (JWKS fetch from Supabase)
      * User still dictating when auth completes
      * ~50 frames queued, flush immediately
      * No perceived latency (auth runs while user speaks)
    
    **Previous Architecture (Pre-2025-12-20):**
    Recording was BLOCKED until auth completed (sequential flow):
    - PTT → Wait for auth (10-800ms) → Recording starts
    - User experienced noticeable freeze on cold starts
    
    Reference: agent-logs/2025-12-20_2235_parallel-auth-recording.md
  </connection_auth>

  <two_level_gating>
    Free tier quota is enforced at two levels:

    1. **Local (App-side)**: Instant feedback
       - Checks localStorage quota before opening WebSocket
       - Shows notification immediately if quota exceeded
       - Purpose: Better UX (no frozen frequency bars, instant error)
       - Security: Display-only, NOT authoritative (can be tampered)

    2. **Server (Worker-side)**: Authoritative enforcement
       - Checks JWT claims quota at WebSocket auth time
       - Closes connection if quota exceeded (code 4021)
       - Purpose: Security boundary (untamperable, source of truth)
       - Cannot be bypassed: JWT signed by Supabase, verified by worker

    **Why both?** Local check provides instant UX feedback. Server check ensures
    security—even if user tampers with localStorage, worker still enforces limit.

    Reference: agent-logs/2025-12-04_1640_fix-quota-system.md
  </two_level_gating>

  <close_codes file="worker/src/auth/index.ts">
    1000: NORMAL_CLOSE - Successful completion
    4011: AUTH_TIMEOUT - No auth message received within 15s
    4012: UNAUTHORIZED - Invalid or expired JWT
    4020: PAYMENT_REQUIRED - Valid user but no active subscription (free tier not implemented for this feature)
    4021: QUOTA_EXCEEDED - Free tier user exceeded weekly word limit (1000 words/week, resets Monday 00:00 UTC)
  </close_codes>

  <architecture_benefits>
    - **Zero perceived latency (2025-12-20)**: Recording starts instantly, auth runs in background (10-50ms typical, invisible to user)
    - **Zero DB queries during transcription**: All entitlement data in JWT (50x faster auth)
    - **Instant blocking**: Quota check happens at connection time, before audio streams
    - **Cryptographically secure**: JWT signature verified via JWKS (Supabase public key)
    - **Edge-cached JWKS**: Two-tier caching (in-memory Map + Cache API) eliminates cold starts
    - **Sub-50ms JWT verification**: JWKS cache reduces cold start rate from 67% to ~5%
    - **Scales infinitely**: Pure CPU work (JWT verification), no database bottleneck
    - **1-hour propagation**: Subscription/quota changes take up to 1 hour to propagate (when JWT refreshes)
    - **Automatic refresh + pre-connect**: App calls refreshSession() on startup, then pre-connects WebSocket
  </architecture_benefits>

  <jwks_caching added="2025-12-12" updated="2025-12-17" file="worker/src/auth/supabaseJwt.ts">
    **Problem:** 67% of JWT verifications had cold starts (>500ms) due to JWKS refetch from Supabase

    **Solution:** Two-tier "cookie jar" caching strategy:

    Tier 1: In-memory Map
    - Instant access (0ms overhead)
    - Cleared on worker restart (frequent in low-traffic periods)
    - 1-hour TTL

    Tier 2: Cloudflare Cache API
    - Edge-local persistence (10-50ms access)
    - Survives worker restarts
    - 1-hour TTL

    Tier 3: Supabase JWKS endpoint (fallback)
    - 500-800ms latency
    - Only when both caches miss or keys rotated

    **Key Rotation Handling:**
    - Catch JWKSNoMatchingKey error on verification failure
    - Clear both cache tiers
    - Retry verification with fresh JWKS
    - Graceful degradation (one retry, then fail)

    **2025-12-17 Fixes:**
    1. **cache.put() now awaited** - Without await, if worker terminates early (loadShed),
       cache.put() was cancelled and edge cache never warmed. Every cold start paid 500ms.
    2. **JWKS prefetch on first request** - Worker middleware calls getJWKS() fire-and-forget
       on first request. Second+ requests hit warm cache (~10ms).

    **Performance Impact:**
    - Cold start rate: 67% → ~0% (prefetch + proper cache population)
    - JWT verification: 10-50ms (consistent, down from 500-800ms on cold starts)

    Reference: agent-logs/2025-12-12_1130_eliminate-cold-starts.md, agent-logs/2025-12-17_2315_websocket-stampede-fix.md
  </jwks_caching>

  <quota_tracking file="worker/src/handlers/ws.ts">
    **Server-Authoritative Architecture:**
    Worker is the single source of truth for quota tracking. App cannot write to database.

    After successful transcription:
    1. Worker counts words from STT output (finalText, NOT LLM output)
       - Why finalText? User pays for what they spoke, not what LLM generated
       - Edit mode example: "make it shorter" (3 words) → LLM outputs 70 words → count 3 ✅
    2. Word count formula: finalText.split(/\s+/).filter(w => w.length > 0).length
    3. Worker fires increment_quota_simple(user_id, word_count) to database (service role)
    4. Uses executionCtx.waitUntil() for fire-and-forget (zero latency impact on response)
    5. Worker includes wordCount in final message for app UI display
    6. App updates localStorage cache for progress bar (instant UI feedback, display-only)
    7. Next JWT refresh syncs localStorage from database truth

    **Security Model:**
    - Worker writes to DB (untamperable, server-authoritative)
    - custom_access_token_hook reads DB → adds claims to JWT (cryptographically signed)
    - Worker validates JWT at auth time → enforces quota
    - App reads JWT/localStorage (display-only, zero security impact if tampered)

    **Latency Optimization:**
    Fire-and-forget DB writes (waitUntil) ensure zero perceived latency:
    - Response sent to client FIRST
    - DB write happens AFTER (non-blocking background task)
    - Cloudflare Workers guarantees completion even after response sent
    - Result: User sees text instantly, quota tracked reliably

    Reference: agent-logs/2025-12-04_1330_free-tier-quota-implementation.md
  </quota_tracking>

  <related_docs>
    - docs/DATABASE.md (Custom Access Token Hook, quota tracking)
    - agent-logs/2025-12-02_1900_payments-auth-optimization.md (JWT claims implementation)
    - agent-logs/2025-12-04_1330_free-tier-quota-implementation.md (Server-authoritative quota system)
    - agent-logs/2025-12-04_1640_fix-quota-system.md (VOLATILE fix, notification improvements)
    - agent-logs/2025-12-03_2225_post-payment-jwt-refresh.md (Startup refresh flow)
  </related_docs>
</auth_flow>

---

## Modes

Spoke has two distinct modes that change how the transcription is processed.

### Dictation Mode (Default)

<mode name="dictation">
  <trigger>No text selected when PTT pressed</trigger>

  <flow>
    1. User speaks into microphone
    2. Audio streams to worker via WebSocket
    3. Worker transcribes via STT (Groq/Fireworks/Deepgram)
    4. Optional: LLM cleans up transcription (punctuation, formatting)
    5. Text inserted at cursor position
  </flow>

  <use_case>
    Writing emails, documents, notes—anywhere you want to convert speech to text.
  </use_case>
</mode>

### Edit Mode

<mode name="edit">
  <trigger>Text selected when PTT pressed (detected via clipboard probe)</trigger>

  <flow>
    1. Helper captures selected text via universal clipboard probe:
       - Snapshots current clipboard state
       - Synthesizes Cmd+C via Carbon Events API
       - Polls clipboard for 180ms (6×30ms intervals) to detect selection
       - Trims whitespace and validates non-empty result
       - Restores original clipboard (user never sees temporary value)
       - NOTE: Context (surrounding text) is NOT captured - only selected text
    2. User speaks editing instruction
    3. Worker transcribes instruction via STT
    4. LLM rewrites original text using instruction
    5. Edited text replaces selection
  </flow>

  <selection_capture>
    <method>Clipboard probe (universal, AX-independent)</method>
    <rationale>
      Clipboard probe is used for all apps rather than AX API because:
      - Electron apps (Cursor, VS Code, Raycast, Slack, Discord) return false {0,0} from AXSelectedTextRange even when text IS selected
      - Web apps (Google Docs, Notion, Figma) don't expose selection via AX API at all
      - Native apps work with both methods, but clipboard is more reliable
      - Latency (~180ms) is invisible since probe happens during dictation start while user is speaking
    </rationale>
    <sources>
      'clipboard' - Successfully captured via Cmd+C (most common)
      'ax' - AX reported selection but clipboard probe failed (rare edge case)
      'none' - No selection detected → falls back to dictation mode
    </sources>
    <compatibility>
      Works universally across native apps, Electron apps, and web-based editors.
      Only fails in secure fields (password inputs) which correctly fall back to dictation.
    </compatibility>
  </selection_capture>

  <use_case>
    "Make this more professional", "Fix the grammar", "Shorten this paragraph"
    Voice-driven text editing without manual rewriting.
  </use_case>
</mode>

The mode is determined automatically based on whether text is selected. No manual switching required.

---

## OCR Context-Aware Transcription

**Added:** 2025-12-12
**Status:** ✅ Production

Spoke uses on-screen context to improve transcription accuracy for proper nouns, domain-specific terminology, and unconventional formatting (e.g., "GOLDBEES" instead of "Gold Bees").

<ocr_pipeline>
  <capture>
    PTT down triggers screenshot capture via Electron's desktopCapturer API
    - Performance: ~293ms capture time
    - Format: JPEG quality 75, max dimension 1080p
    - Size: ~101KB (80% reduction from lossless)
    - Timing: Fire-and-forget (doesn't block audio pipeline)
  </capture>

  <extraction>
    Worker OCR Service extracts proper nouns from screenshot:
    - Model: Groq Llama 4 Scout (vision-enabled LLM)
    - Latency: 800-1200ms (typically completes before STT for dictations >1s)
    - Max words: 100 proper nouns
    - Output: Structured JSON with extracted vocabulary
  </extraction>

  <enrichment>
    OCR words integrated into transcription pipeline:
    1. STT Vocabulary: Merged into buildSTTPrompt() with case-insensitive deduplication
    2. LLM System Prompt: Fuzzy matching instructions to replace phonetically similar words with exact vocabulary spellings
  </enrichment>

  <websocket>
    Client sends context_ocr message after start message:
    {
      "type": "context_ocr",
      "screenshot": "base64_jpeg_data",
      "traceId": "..."
    }

    Worker processes asynchronously via c.executionCtx.waitUntil() (non-blocking)
  </websocket>

  <accuracy_improvement>
    - Proper nouns: "GOLDBEES" ✅ (not "Gold Bees")
    - Domain terminology: User-specific jargon, product names, acronyms
    - Formatting: Preserves capitalization and spacing from on-screen content
    - Works universally: Native apps, Electron apps, web-based editors
  </accuracy_improvement>

  <privacy>
    - Screenshots never stored (ephemeral worker processing only)
    - OCR words used for single transcription session only
    - No persistent storage of visual content
  </privacy>

  <files>
    Client: src/utils/screenshot.ts, src/main.ts (IPC handlers)
    Worker: worker/src/services/ocr/ (index.ts, prompt.ts, types.ts)
    Protocol: worker/src/types/messages.ts (ClientContextOcrMessage)
    Integration: worker/src/services/stt/prompt.ts, worker/src/services/llm/prompt.ts
  </files>

  <related_logs>
    - agent-logs/2025-12-12_1334_ocr-context-transcription.md (implementation)
    - agent-logs/2025-12-12_1703_screen-recording-permission.md (macOS permission required)
  </related_logs>
</ocr_pipeline>

**Requirements:** Screen Recording permission (macOS) - added to onboarding flow as 4th (final) permission.

---

## Audio Capture

<audio_capture file="src/hooks/useTranscription.ts">
  <constraints>
    getUserMedia() requests:
    - sampleRate: 48000 (device native)
    - channelCount: 1 (mono)
    - echoCancellation: false
    - noiseSuppression: true
    - autoGainControl: false
  </constraints>

  <features>
    - Device-specific targeting (non-default mic support)
    - Real-time device change detection + stream reinitialization
    - Constraint validation with actual settings logging
  </features>

  <worklet file="public/worklets/pcm16-downsampler.worklet.js">
    <resampling>
      - 16kHz input: passthrough (direct Float32 → Int16)
      - 48kHz input: decimate-by-3 (FIR low-pass, 31-tap Hamming window)
      - Other rates: linear interpolation with anti-aliasing
    </resampling>

    <buffering>
      Accumulates 1600 samples (100ms at 16kHz), posts as transferable ArrayBuffer.
      Flush support on stop prevents audio loss (partial frame emission).
    </buffering>
  </worklet>

  <vad_silence_cutting updated="2025-12-11" file="src/utils/vadStreamGate.ts">
    **Per-Frame Speech Detection:**
    VAD evaluates EACH frame independently for speech content (not just session start/end):

    - Only frames containing actual speech are forwarded to server (using SPEECH_PROB_END threshold)
    - Silence frames during pauses → buffered to pre-roll, not sent
    - Prevents Whisper hallucinations caused by weak/trailing audio

    **SENTENCE_PAUSE_MS:** 700ms → 1500ms (2025-12-11)
    - Conservative threshold for natural sentence boundaries
    - Only chunks on true "full stop" pauses, not brief pauses for thought

    **Result:** Chunks contain dense, speech-only audio with minimal silence

    Reference: agent-logs/2025-12-11_2015_vad-silence-cutting-fix.md
  </vad_silence_cutting>
</audio_capture>

---

## Chunked Transcription (DEPRECATED)

**Status:** Completely removed as of 2025-12-12

**Reason:** The async chunk STT implementation caused worker hangs (wall time 100+ seconds with only 10ms CPU time) due to untracked async IIFEs that kept workers alive indefinitely. All audio is now processed in a single request.

**Root Cause:**
```typescript
// Bad pattern - created orphaned async operations
(async () => {
  await transcribeWav(...);
})();  // NOT wrapped in waitUntil()!
```
This created orphaned promises that kept the worker alive indefinitely waiting for completion without being tracked by Cloudflare's execution context.

**Configuration:**
- `CHUNK_DETECTION_ENABLED = false` in `src/config/vad.ts`
- Worker `chunk` message handler replaced with 12-line no-op (logs and ignores)

**Dead Code Cleanup (2025-12-12):**
Comprehensive cleanup removed ~350 lines of dead code:

Client-side (`src/hooks/useTranscription.ts`):
- Removed chunk state refs (chunkResultsRef, pendingChunksRef, currentChunkIndexRef)
- Removed chunk_result message handler (20 lines)
- Removed chunk state logging and reset logic
- Simplified chunk detection callback to no-op

Worker-side (`worker/src/handlers/ws.ts`):
- Removed polling logic (8-second loop waiting for pendingChunkSTT)
- Removed chunked vs non-chunked branching (95 lines)
- Removed chunk metrics from worker response

Files deleted:
- `src/utils/chunkDetector.ts` (140 lines) - Entire chunk detection class
- Updated `src/utils/vadStreamGate.ts` to remove chunk detection imports/methods

**History:**
- Initial implementation: `agent-logs/2025-12-01_2102_chunked-transcription.md`
- Deprecation + initial fix: `agent-logs/2025-12-12_2215_chunking-disabled-worker-hang-fix.md`
- Complete dead code cleanup: Same log, "Follow-up" section

**Future Consideration:**
If chunking is re-enabled, the implementation must:
1. Wrap chunk STT in `c.executionCtx.waitUntil()` for proper background work tracking
2. Replace polling loops with `Promise.all()` for chunk completion
3. Add proper abort handling for cleanup

For now, single-shot processing is reliable and performant for all dictation lengths.

---

## WebSocket Protocol

<websocket>
  <connection>
    <url>getTranscribeWsUrl() - env-specific (ws://127.0.0.1:8787/ws or wss://api.spoke.so/ws)</url>
    <binary_type>arraybuffer</binary_type>
    <singleflight added="2025-12-17" file="src/hooks/useTranscription.ts">
      **Problem:** Multiple callers (preConnect, start, reconnect) could create parallel WebSocket 
      connections, causing Cloudflare loadShed errors (3x concurrent requests).
      
      **Solution:** Singleflight pattern using connectionPromiseRef:
      - If connection in progress, return existing Promise instead of creating new connection
      - Promise cleared in .finally() to allow fresh attempts after completion/failure
      - Prevents stampede: N callers → 1 connection attempt
      
      **Implementation:**
      ```typescript
      if (connectionPromiseRef.current) return connectionPromiseRef.current;
      connectionPromise = (async () => { ... })();
      connectionPromiseRef.current = connectionPromise.finally(() => {
        connectionPromiseRef.current = null;
      });
      return connectionPromiseRef.current;
      ```
    </singleflight>
    <starting_state added="2025-12-17" file="src/hooks/useTranscription.ts">
      **Problem:** Double-tap race condition - stop() returns early if recording=false, 
      but recording only becomes true AFTER auth completes. User taps "stop" during cold 
      start, but recording starts anyway.
      
      **Solution:** startingRef tracks in-flight start attempts:
      - Set true at start() entry, cleared on success, error, or stop/cancel
      - stop() checks startingRef and cancels if true
      - All early returns in start() clear startingRef to prevent stuck state
      
      **Early return points that clear startingRef:**
      - Quota exceeded (line 1177)
      - Stream open fail (line 1259)
      - Catch block (line 1524)
    </starting_state>
    <reconnection>
      Exponential backoff: 150ms base, doubles each attempt (max 2s).
      Circuit breaker: max 10 attempts, then 60s cooldown.
    </reconnection>
    <flow_control>
      Client-side buffering when WebSocket buffer > 512KB.
      Queue flush with 10ms retry. 20MB total buffer limit.
    </flow_control>
  </connection>

  <binary_frame>
    <header bytes="16">
      [0:4]   sequence (u32, little-endian) - Frame number for gap detection
      [4:8]   payload_size (u32, little-endian) - PCM data byte count
      [8:12]  timestamp_low (u32, little-endian) - Client timestamp (low 32 bits)
      [12:16] timestamp_high (u32, little-endian) - Client timestamp (high 32 bits)
    </header>
    <payload>PCM16 audio data (payload_size bytes)</payload>
  </binary_frame>

  <messages>
    <auth>
      Client sends first (within 15s of connection):
      {
        "type": "auth",
        "token": "eyJhbG...", // Supabase JWT access token
        "traceId": "..."      // optional (for correlating auth + session logs)
      }

      Server responses:
      Success: { "type": "auth_ok" }
      Failure: { "type": "auth_error", "error": "...", "code": 4011|4012|4020|4021 }

      Auth must complete before any other messages. Connection closed if auth fails.
    </auth>

    <start>
      Client sends on PTT down:
      {
        "type": "start",
        "version": 2,
        "format": "pcm16le",
        "rate": 16000,
        "language": "en",
        "traceId": "...",
        "mode": "dictation" | "edit",
        "selection": { ... }, // edit mode only
        "shareTranscriptions": boolean,
        "identity": { "name": "...", "email": "..." } // optional
      }
    </start>

    <context_ocr added="2025-12-12">
      Client sends after start (optional, for context-aware transcription):
      {
        "type": "context_ocr",
        "screenshot": "base64_encoded_jpeg_data",
        "traceId": "..."
      }

      Worker processes asynchronously (fire-and-forget via executionCtx.waitUntil):
      - Sends screenshot to OCR service (Groq Llama 4 Scout)
      - Extracts proper nouns and domain-specific vocabulary
      - Merges OCR words into STT prompt and LLM system prompt
      - No acknowledgment message sent (non-blocking)

      Timing: OCR completes in ~800-1200ms, typically before STT for dictations >1s
    </context_ocr>

    <chunk>
      Client sends during dictation (on natural sentence pause):
      {
        "type": "chunk",
        "chunkIndex": 0,  // Incremental chunk number
        "audioMs": 10230  // Duration of audio in this chunk (milliseconds)
      }

      Worker snapshots accumulated audio, starts STT immediately (async).
      Enables progressive transcription for long dictations.
    </chunk>

    <end>
      Client sends on PTT up: { "type": "end" }
      Triggers final transcription processing.
      If chunked session: waits for pending chunk STTs, processes remaining audio.
    </end>

    <status>
      Server → Client when processing starts:
      { "type": "status", "state": "processing", "traceId": "...", "serverTs": ... }
    </status>

    <chunk_result>
      Server → Client when chunk STT completes:
      {
        "type": "chunk_result",
        "chunkIndex": 0,
        "text": "...",  // Transcribed text for this chunk
        "traceId": "..."
      }

      Allows progressive UI updates during long dictations.
      Client receives chunk results while still speaking.
    </chunk_result>

    <llm_status>
      Server → Client when LLM starts:
      { "type": "llm_status", "state": "llm_processing", "traceId": "..." }
    </llm_status>

    <llm_delta>
      Server → Client during streaming:
      { "type": "llm_delta", "delta": "...", "traceId": "..." }
      Allows progressive UI updates while LLM generates.
    </llm_delta>

    <final>
      Server → Client with result:
      {
        "type": "final",
        "text": "...",
        "wordCount": 42,  // Word count for quota tracking (STT output only)
        "traceId": "...",
        "dataset": { "sttText": "...", "llmText": "..." }, // if shareTranscriptions
        "metrics": { "worker": { ... } }
      }

      wordCount is calculated from finalText (STT output), NOT responseText (LLM output).
      In edit mode, counts spoken instruction words, not LLM-generated rewrite.
    </final>

    <error>
      Server → Client on failure:
      {
        "type": "error",
        "code": 4001 | 4002 | 4003 | 4004,
        "body": "...",
        "retryable": boolean
      }
      Codes: 4001=STT_API_ERROR, 4002=STT_TIMEOUT, 4003=AUDIO_TOO_LARGE, 4004=AUDIO_PROCESSING_FAILED
    </error>
  </messages>
</websocket>

---

## Server-Side Processing

<worker file="worker/src/handlers/ws.ts">
  <security>
    - JWT authentication: Verifies Supabase JWT signature using JWKS
    - Entitlement gating: Checks subscription_active or quota claims at auth time
    - Rate limit: 5 concurrent connections per IP
    - Payload limit: 20MB max session size
    - Connection tracking with automatic cleanup
    - Auth timeout: 15s to send auth message after connection
  </security>

  <session>
    Accumulates binary frames and tracks state:
    - traceId, chunks[], totalBytes, frames, seqGaps
    - firstArrivalMs, lastArrivalMs
    - mode ('dictation' | 'edit'), selection
    - shareTranscriptions, identity { name, email }
    - Chunked transcription state:
      - chunkStates: Map<number, ChunkState> - Audio snapshots per chunk
      - pendingChunkSTT: Set<number> - Ongoing STT operations
      - currentChunkIndex: number - Next chunk index
  </session>

  <assembly file="worker/src/audio/codec.ts">
    On "end" message:

    For chunked sessions:
    1. Wait for all pending chunk STTs (15s timeout)
    2. Collect chunk results in order (by chunkIndex)
    3. Process remaining audio (final chunk) if present
    4. Concatenate: [chunk0, chunk1, ..., remaining].join(' ').trim()

    For non-chunked sessions:
    1. concat() - Combine PCM chunks into single Uint8Array
    2. wrapWav() - Add 44-byte WAV header (RIFF/WAVE/fmt/data chunks)
    3. Pass to STT provider
  </assembly>

  <quota_tracking>
    After successful transcription (both chunked and non-chunked):
    1. Calculate word count from finalText (STT output):
       wordCount = finalText.split(/\s+/).filter(w => w.length > 0).length
    2. Fire increment_quota_simple(user_id, word_count) in background:
       executionCtx.waitUntil(
         fetch(supabaseUrl + '/rest/v1/rpc/increment_quota_simple', {
           method: 'POST',
           headers: { apikey, authorization, content-type },
           body: JSON.stringify({ p_user_id: userId, p_word_count: wordCount })
         })
       )
    3. Include wordCount in final message for app UI
    4. Zero latency: Response sent before DB write completes

    Why count finalText (STT) not responseText (LLM):
    - Fairness: User pays for what they spoke, not what LLM generated
    - Edit mode: "make it shorter" (3 words) → LLM outputs 70 words → count 3 ✅
    - Normal dictation: STT and LLM output similar length → same result
  </quota_tracking>

  <telemetry file="worker/src/utils/analytics.ts">
    **Updated:** 2025-12-19 - Consolidated into a single `session.lifecycle` event

    After session completes:
    - Write to Cloudflare Analytics Engine (zero latency, fire-and-forget)
    - Event tracked: `session.lifecycle` (consolidates auth, OCR, STT, LLM, and quota metrics)
    - Schema: 1 index (user_id), 7 blobs (outcome, mode, providers, error_stage), 15 doubles (timing breakdown, traffic metrics)
    - Benefits: 50% reduction in write operations, complete correlation across all pipeline stages
    - Does NOT store transcription text (privacy)
    - Query via SQL in Cloudflare Dashboard

    **Key Metrics:**
    - `double2`: JWT verification time (auth_ms)
    - `double15`: Cold start flag (1 if auth > 500ms, indicates JWKS fetch)
    - `double8`: Router overhead (time between STT → LLM)
    - `double12/13/14`: Audio quality (frames, size, sequence gaps)
    - P95/P99 latency percentiles for bottleneck identification

    **Removed (2025-12-19):**
    - Deprecated `auth.jwt_verify` and `db.quota_increment` events in favor of consolidated lifecycle event.
    - Removed Sentry instrumentation (2025-12-11) - eliminated 150-200 network calls per request.

    Reference: agent-logs/2025-12-11_2330_nuke-instrumentation-complete.md, agent-logs/2025-12-19_1920_analytics-engine-integration.md
  </telemetry>
</worker>

---

## STT Providers

Multiple STT providers are supported, runtime-switchable via env vars.

<stt>
  <dispatcher file="worker/src/services/stt/index.ts">
    Selects provider based on runtime.stt.provider (from env).
    Applies hallucination filter to all results.
  </dispatcher>

  <providers>
    <groq default="true">
      <endpoint>https://gateway.ai.cloudflare.com/.../groq/audio/transcriptions</endpoint>
      <auth>Authorization: Bearer {GROQ_API_KEY}</auth>
      <model default="whisper-large-v3">Override with GROQ_STT_MODEL or STT_MODEL env var</model>
    </groq>

    <fireworks>
      <endpoint>https://audio-turbo.api.fireworks.ai/v1/audio/transcriptions</endpoint>
      <auth>Authorization: {FIREWORKS_API_KEY} (no Bearer prefix)</auth>
      <model default="whisper-v3-turbo">Override with FIREWORKS_STT_TURBO_MODEL or STT_MODEL</model>
      <params>temperature=0.0,0.2,0.4, vad_model=silero, alignment_model=tdnn_ffn, preprocessing=none</params>
    </fireworks>

    <deepgram>
      <endpoint>https://api.deepgram.com/v1/listen</endpoint>
      <auth>Authorization: Token {DEEPGRAM_API_KEY}</auth>
      <model default="nova-3">Override with DEEPGRAM_STT_DEFAULT_MODEL or STT_MODEL</model>
      <features>Automatic punctuation + paragraphs</features>
    </deepgram>
  </providers>

  <vocabulary file="worker/src/services/stt/prompt.ts">
    <base>Your vocabulary includes: Spoke</base>

    <enhancement>
      buildSTTPrompt() enhances base prompt with user identity:
      1. Extracts identity.name → splits by whitespace → adds each token
      2. Adds identity.email as single token
      3. Sanitizes: strips control chars, angle brackets, limits to 80 chars
      4. Deduplicates case-insensitively
      5. Appends to base prompt

      Example: identity.name="Ada Lovelace" →
      "Your vocabulary includes: Spoke, Ada, Lovelace"
    </enhancement>

    <purpose>
      Improves STT accuracy for proper nouns (user's name, email).
      Sent to STT API as "prompt" parameter.
    </purpose>
  </vocabulary>

  <hallucination_filter file="worker/src/services/stt/postprocess.ts">
    Removes YouTube training artifacts from transcription end:
    - "Thank you for watching!"
    - "Subtitles by the Amara.org community."
    Applied automatically after every STT call.
  </hallucination_filter>

  <env_vars>
    STT_PROVIDER=groq|fireworks|deepgram (default: groq)
    STT_MODEL=... (overrides provider default)
    STT_PROMPT=... (custom vocabulary base)
    STT_LANGUAGE=en
    STT_TIMEOUT_MS=25000
    GROQ_API_KEY, FIREWORKS_API_KEY, DEEPGRAM_API_KEY
  </env_vars>
</stt>

---

## LLM Post-Processing

Optional LLM enhancement for dictation cleanup or edit mode rewrites.

<llm>
  <modes>
    <dictation_cleanup enabled="runtime.llm.enabled">
      STT text → LLM cleanup → Final text
      System prompt includes current date, user identity, STT vocabulary hints.
      LLM fixes punctuation, grammar, formatting.
    </dictation_cleanup>

    <edit_mode enabled="runtime.edit.enabled">
      STT instruction + selected text → LLM rewrite → Final text
      prepareEditRequest() builds plain-text prompt:
        "Instructions: {STT instruction}
         Original Text: {selected text}"
      System prompt: "Return rewritten text only, no explanation."
      Fallback: Returns original selection if error or API key missing.
    </edit_mode>
  </modes>

  <providers>
    <groq>
      <endpoint>https://gateway.ai.cloudflare.com/.../groq/chat/completions</endpoint>
      <default_model>meta-llama/llama-4-maverick-17b-128e-instruct</default_model>
      <edit_model>moonshotai/kimi-k2-instruct-0905</edit_model>
    </groq>

    <openai>
      <endpoint>https://api.openai.com/v1/chat/completions</endpoint>
      <default_model>gpt-4.1-mini</default_model>
      <edit_model>gpt-4.1-mini</edit_model>
    </openai>

    <baseten>
      <endpoint>https://gateway.ai.cloudflare.com/.../baseten/v1/chat/completions</endpoint>
      <default_model>deepseek-ai/DeepSeek-V3.1</default_model>
      <edit_model>moonshotai/Kimi-K2-Instruct-0905</edit_model>
    </baseten>

    <cerebras added="2025-12-05" default="true">
      <endpoint>https://gateway.ai.cloudflare.com/.../cerebras/v1/chat/completions</endpoint>
      <default_model>llama-3.3-70b</default_model>
      <edit_model>qwen-3-235b-a22b-instruct-2507</edit_model>
      <performance>Fast inference (50-150ms TTFB), competitive with Groq</performance>
      <caching>Behind AI Gateway with caching enabled</caching>
    </cerebras>

    <openrouter>
      <endpoint>https://openrouter.ai/api/v1/chat/completions</endpoint>
      <default_model>qwen/qwen3-235b-a22b-2507</default_model>
      <edit_model>qwen/qwen3-235b-a22b-2507</edit_model>
      <config>
        Supports provider routing: OPENROUTER_PROVIDER_SORT, OPENROUTER_PROVIDER_ORDER, etc.
        See worker/src/handlers/ws.ts:78-124 for full config.
      </config>
    </openrouter>
  </providers>

  <routing file="worker/src/services/llm/routing.ts">
    <rules>
      - Regex heuristics (spelling requests, formatting directives)
      - Length threshold: ≥1200 chars OR ≥180 words → routes to edit model
      - Matched rule IDs logged (e.g., "length-threshold")
    </rules>
    <toggle>LLM_ROUTER_ENABLED=0 to disable</toggle>
    <purpose>
      Automatically uses larger context models for long-form content.
      Routes special requests (spelling, formatting) to appropriate models.
    </purpose>
  </routing>

  <streaming>
    When LLM_STREAM=1 (default):
    1. Worker sends llm_status when LLM starts
    2. Streams llm_delta messages with text chunks
    3. Client updates UI progressively
    4. Final result contains complete text

    Provides faster perceived latency—user sees text appear as it's generated.
  </streaming>

  <env_vars>
    LLM_PROVIDER=openai|groq|baseten|cerebras|openrouter (default: cerebras as of 2025-12-05)
    LLM_MODEL=... (overrides provider default)
    LLM_TEMPERATURE=0.2
    LLM_TIMEOUT_MS=25000
    LLM_STREAM=1
    LLM_ROUTER_ENABLED=1
    ENABLE_LLM=1

    EDIT_LLM_ENABLED=1
    EDIT_LLM_PROVIDER=... (default: cerebras as of 2025-12-05)
    EDIT_LLM_MODEL=... (overrides provider default)
    EDIT_LLM_TEMPERATURE=0.6
    EDIT_LLM_TIMEOUT_MS=25000
    EDIT_LLM_STREAM=1

    OPENAI_API_KEY, GROQ_API_KEY, BASETEN_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY
  </env_vars>
</llm>

---

## Text Insertion

<native file="native/spoke-helper.c">
  <flow>
    1. Detect focused app + UI element (AX API)
    2. Verify accessibility permissions + element capabilities
    3. Simulate Cmd+V with clipboard manipulation
    4. Optional verification via AX API
  </flow>

  <features>
    - Universal compatibility (works with any text field accepting keyboard input)
    - Graceful degradation when permissions unavailable
    - Pre-spawned daemon reduces latency by ~25ms
  </features>

  <architecture>
    Electron main process spawns helper as daemon.
    IPC calls helper for each paste operation.
    Helper manipulates clipboard, synthesizes paste event, restores clipboard.
  </architecture>
</native>

---

## Performance Metrics

Comprehensive timing instrumentation across client and server, with telemetry via Cloudflare Analytics Engine.

<metrics>
  <client file="src/hooks/useTranscription.ts:71-92">
    sessionId, pttDownMs, stopInvokedMs, wsOpenMs, firstFrameOutMs,
    lastFrameOutMs, endSentMs, statusRecvMs, finalRecvMs,
    pasteStartMs, pasteDoneMs, postRollStartMs, postRollEndMs,
    drainDoneMs, framesProduced, bytesProduced, framesQueued, framesSentApprox
  </client>

  <server file="worker/src/utils/analytics.ts">
    **Analytics Engine Events:**
    - `session.lifecycle`: outcome, mode, providers, error_stage, duration breakdown (auth, OCR, STT, LLM, overhead), audio quality (frames, bytes, gaps), cold_start

    **Session Metrics (not persisted, returned in final message):**
    traceId, wsAcceptAt, startedAt, processingStartAt,
    frames, bytes, seqGaps, firstArrivalMs, lastArrivalMs,
    assembleMs, stt { ttfbMs, bodyMs, totalMs },
    llm { ttfbMs, bodyMs, totalMs, firstTokenMs }
  </server>

  <derived>
    dictationMs = stopInvokedMs - pttDownMs (user speech duration)
    e2eMs = pasteDoneMs - stopInvokedMs (system latency post-dictation)
    totalMs = pasteDoneMs - pttDownMs (full session)
    captureMs = postRollMs + drainMs (audio overhead)
    sttMs = STT API processing time
    llmMs = LLM processing time (if enabled)
    pasteMs = Native text insertion time
    authMs = JWT verification time (tracked in Analytics Engine)
  </derived>

  <logging>
    **Client Logs:**
    console.log("[SF] E2E", { traceId, dictationMs, e2eMs, totalMs, sttMs, llmMs, pasteMs, ... })

    **Worker Logs:**
    - Session summary with all timing data (console only, not persisted)
    - Analytics Engine: `session.lifecycle` event (consolidated metrics)

    **Telemetry:**
    - Replaced Sentry + dictation_logs (2025-12-11/13)
    - Replaced separate auth/quota events with `session.lifecycle` (2025-12-19)
    - Analytics Engine queries via SQL in Cloudflare Dashboard
    - P95/P99 latency analysis for bottleneck identification

    Both correlated via traceId for end-to-end visibility.
  </logging>

  <optimization_history>
    - 2025-12-11: Sentry purge (400s → 1.5s wall time, 266x improvement)
    - 2025-12-12: JWKS edge caching (cold start rate 67% → 5%)
    - 2025-12-10: Pre-connect on startup (eliminated 4-5s first-dictation freeze)
    - 2025-12-06: WebSocket retry logic (handles Cloudflare edge rejections)

    Reference: agent-logs/2025-12-11_2330_nuke-instrumentation-complete.md
  </optimization_history>
</metrics>

---

## Error Handling

<errors>
  <layers>
    <connection>
      - WebSocket errors → auto-reconnect with exponential backoff
      - Network interruptions → client-side buffering
      - Server unavailable → circuit breaker prevents excessive retries
    </connection>

    <audio>
      - Device errors → fallback to default microphone
      - Permission denied → user guidance
      - Stream interruption → auto-reinitialization
    </audio>

    <processing>
      - Server errors → detailed messages with context
      - API failures → timeout protection with cleanup
      - Invalid responses → JSON parsing with error boundaries
    </processing>
  </layers>

  <error_codes>
    4001: STT_API_ERROR - STT provider failure
    4002: STT_TIMEOUT - STT request exceeded timeout
    4003: AUDIO_TOO_LARGE - Session exceeded 20MB limit
    4004: AUDIO_PROCESSING_FAILED - Audio worklet/processing error
  </error_codes>

  <cancellation>
    User can cancel at any stage:
    - Aborts in-flight STT/LLM requests
    - Disconnects audio nodes
    - Closes WebSocket
    - Resets all state
  </cancellation>
</errors>

---

## Configuration

<config>
  <audio file="src/config/audio.ts">
    MICROPHONE_PREFERRED_RATE=48000
    TARGET_SAMPLE_RATE=16000
    CHUNK_MS=100
    SAMPLES_PER_CHUNK=1600
    POST_ROLL_MS=240 (prevents end-of-speech clipping)
    WS_MAX_BUFFERED_BYTES=524288 (512KB backpressure threshold)
  </audio>

  <runtime file="worker/src/config/runtime.ts">
    getRuntimeConfig(env) reads env vars at runtime, returns typed config:
    { llm, stt, edit }

    Defaults from worker/src/config.ts.
    Allows switching providers without code changes.
  </runtime>
</config>

---

## Modularity & Customization

The worker architecture is designed for extreme modularity, allowing developers to switch models and providers in seconds.

<central_config file="worker/src/config.ts">
  The entire transcription and LLM pipeline is controlled by a single configuration file.
  To switch providers or models, simply update the default constants:

  ```typescript
  // Switch LLM provider (e.g., from 'groq' to 'openai')
  export const LLM_DEFAULT_PROVIDER = 'openai' as const;

  // Switch LLM model
  export const LLM_DEFAULT_MODEL = OPENAI_LLM_DEFAULT_MODEL;

  // Switch STT provider
  export const STT_DEFAULT_PROVIDER = 'deepgram' as const;
  ```

  This design allows for:
  - **Rapid Prototyping**: Test new models (e.g., Llama 3, GPT-4o) by changing one line.
  - **Provider redundancy**: If one provider goes down, switch to another instantly.
  - **A/B Testing**: Easily configure different environments with different models.

  All provider-specific endpoints and model names are also defined here, making it the single source of truth for the worker's external dependencies.
</central_config>

---

## History Storage

Transcription history is stored locally on the user's device—never in the database.

<history>
  <architecture>
    Memory-first pattern:
    1. App start → load from disk (electron-store) → cache in memory
    2. Dictation complete → save to disk + update memory → notify subscribers
    3. Tab switch → instant read from memory (no I/O)
  </architecture>

  <storage>
    <backend>electron-store (persistent JSON in app data directory)</backend>
    <schema>{ id: string, text: string, timestamp: number, mode: string }</schema>
    <limit>1000 items max (auto-pruned via array.slice())</limit>
  </storage>

  <state file="src/state/transcriptionHistory.ts">
    Pub/sub pattern for reactive updates:
    - subscribeTranscriptionHistory(callback)
    - getTranscriptionHistory() - instant, from memory
    - addTranscription(text, mode) - save + notify
  </state>

  <autosave file="src/hooks/useTranscription.ts">
    On "final" message, addTranscription() called automatically.
    Fire-and-forget (no user wait).
  </autosave>

  <privacy>
    Local storage only. Telemetry stores metadata (durations, word counts), NOT text.
    User has full control over their transcription history.
  </privacy>
</history>

---

## Troubleshooting

### Quota Not Syncing to App

**Symptom**: User has used words but progress bar shows 0, or quota exceeded error doesn't appear when expected.

**Common Causes:**

1. **JWT Not Refreshed**: Quota claims are only updated when JWT refreshes (on app startup or explicit refresh)
   - **Solution**: Restart app or wait for automatic JWT refresh (1 hour)
   - **Verification**: Check localStorage: `localStorage.getItem('sf.quotaWordsUsed')`

2. **Database Hook Not Working**: custom_access_token_hook may be failing silently
   - **Solution**: See DATABASE.md troubleshooting section (VOLATILE/STABLE issue)
   - **Verification**: Check database directly vs JWT claims vs localStorage

3. **Stale localStorage Cache**: App cache out of sync with database between sessions
   - **Expected**: This is normal and acceptable (refreshes on next startup)
   - **User Impact**: None (server-side quota is authoritative, local is display-only)

**Debugging Steps:**
```bash
# 1. Check database truth
SELECT words_used_this_week, quota_reset_date FROM profiles WHERE id = auth.uid();

# 2. Force JWT refresh in app (DevTools Console)
await window.supabase.auth.refreshSession();

# 3. Check localStorage cache
localStorage.getItem('sf.quotaWordsUsed');
localStorage.getItem('sf.quotaLimit');

# 4. Test dictation
# - Local check happens first (instant notification if exceeded)
# - Server check happens at WebSocket auth (close code 4021 if exceeded)
# - Worker logs show JWT claims quota in auth verification
```

### Notification Not Appearing on Quota Exceeded

**Symptom**: User presses PTT when quota exceeded, but no notification appears. Frequency bars freeze.

**Fixed**: 2025-12-04 (agent-logs/2025-12-04_1640_fix-quota-system.md)

**Solution Applied:**
- Added local quota check before WebSocket connection (instant feedback)
- Clear authError state before each attempt (ensures useEffect re-triggers)
- Send notification directly + set error state (redundant notification paths)
- Added "Quota" to error pattern recognition in catch block
- Enhanced pill reducer to handle quota error messages

**Verification**: Set `localStorage.setItem('sf.quotaWordsUsed', '1000')` and try to dictate. Notification should appear immediately.

---

**Last Updated**: 2025-12-20
**Pipeline Version**: OCR context-aware transcription, JWT authentication with JWKS edge caching, single-shot audio processing, quota tracking, edit mode, multi-provider support (5 LLM providers, 3 STT providers), Consolidated Analytics Engine telemetry
