# Transcription Pipeline

Sonic Flow's transcription pipeline transforms voice into text through real-time audio streaming, speech recognition, and optional LLM enhancement. The entire flow—from microphone to text insertion—happens in under 2 seconds.

**Related:** `docs/DATABASE.md`, `docs/INSTRUMENTATION.md`, `docs/DESIGN.md`

---

## Philosophy

The transcription pipeline is built on three principles:

1. **Speed**: Sub-2s end-to-end latency from release to paste
2. **Flexibility**: Multiple STT/LLM providers, runtime-switchable
3. **Privacy**: No text stored in database, only local + ephemeral server processing

The system supports two modes: **dictation** (voice → text) and **edit** (voice instruction → rewrite selected text).

---

## Pipeline Flow

<pipeline>
  <stage name="capture">
    Microphone → getUserMedia() → 48kHz mono stream
  </stage>

  <stage name="process">
    AudioWorklet resamples to 16kHz PCM16, buffers into 100ms frames (1600 samples)
  </stage>

  <stage name="stream">
    WebSocket sends binary frames with 16-byte headers (sequence, size, timestamp)
  </stage>

  <stage name="transcribe">
    Cloudflare Worker concatenates PCM, wraps in WAV, calls STT API (Groq/Fireworks/Deepgram)
  </stage>

  <stage name="enhance">
    Optional LLM post-processing (cleanup for dictation, rewrite for edit mode)
  </stage>

  <stage name="insert">
    Native helper (C binary) pastes text at cursor via macOS Accessibility API
  </stage>
</pipeline>

Each stage is optimized for low latency—audio worklet runs in dedicated thread, WebSocket uses binary protocol, STT/LLM calls happen in parallel where possible.

---

## Modes

Sonic Flow has two distinct modes that change how the transcription is processed.

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
  <trigger>Text selected when PTT pressed (detected via AX API)</trigger>

  <flow>
    1. Helper captures selected text via clipboard probe:
       - Synthesizes Cmd+C via Carbon Events API
       - Reads plain text from clipboard
       - Restores original clipboard (user never sees temporary value)
    2. User speaks editing instruction
    3. Worker transcribes instruction via STT
    4. LLM rewrites original text using instruction
    5. Edited text replaces selection
  </flow>

  <selection_capture>
    <method>Clipboard probe with backup/restore</method>
    <sources>
      'clipboard' - Successfully captured via Cmd+C
      'ax' - Fallback (not currently implemented)
      'none' - Failed (secure fields, etc.) → falls back to dictation
    </sources>
  </selection_capture>

  <use_case>
    "Make this more professional", "Fix the grammar", "Shorten this paragraph"
    Voice-driven text editing without manual rewriting.
  </use_case>
</mode>

The mode is determined automatically based on whether text is selected. No manual switching required.

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
</audio_capture>

---

## WebSocket Protocol

<websocket>
  <connection>
    <url>getTranscribeWsUrl() - env-specific (ws://127.0.0.1:8787/ws or wss://api.sonicflow.app/ws)</url>
    <binary_type>arraybuffer</binary_type>
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

    <end>
      Client sends on PTT up: { "type": "end" }
      Triggers transcription processing.
    </end>

    <status>
      Server → Client when processing starts:
      { "type": "status", "state": "processing", "traceId": "...", "serverTs": ... }
    </status>

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
        "traceId": "...",
        "dataset": { "sttText": "...", "llmText": "..." }, // if shareTranscriptions
        "metrics": { "worker": { ... } }
      }
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
    - Rate limit: 5 concurrent connections per IP
    - Payload limit: 20MB max session size
    - Connection tracking with automatic cleanup
  </security>

  <session>
    Accumulates binary frames into session object:
    - traceId, chunks[], totalBytes, frames, seqGaps
    - firstArrivalMs, lastArrivalMs
    - mode ('dictation' | 'edit'), selection
    - shareTranscriptions, identity { name, email }
  </session>

  <assembly file="worker/src/audio/codec.ts">
    On "end" message:
    1. concat() - Combine PCM chunks into single Uint8Array
    2. wrapWav() - Add 44-byte WAV header (RIFF/WAVE/fmt/data chunks)
    3. Pass to STT provider
  </assembly>
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
    <base>Your vocabulary includes: Sonic Flow</base>

    <enhancement>
      buildSTTPrompt() enhances base prompt with user identity:
      1. Extracts identity.name → splits by whitespace → adds each token
      2. Adds identity.email as single token
      3. Sanitizes: strips control chars, angle brackets, limits to 80 chars
      4. Deduplicates case-insensitively
      5. Appends to base prompt

      Example: identity.name="Ada Lovelace" →
      "Your vocabulary includes: Sonic Flow, Ada, Lovelace"
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

    <baseten default="true">
      <endpoint>https://gateway.ai.cloudflare.com/.../baseten/v1/chat/completions</endpoint>
      <default_model>deepseek-ai/DeepSeek-V3.1</default_model>
      <edit_model>moonshotai/Kimi-K2-Instruct-0905</edit_model>
    </baseten>

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
    LLM_PROVIDER=openai|groq|baseten|openrouter (default: baseten)
    LLM_MODEL=... (overrides provider default)
    LLM_TEMPERATURE=0.2
    LLM_TIMEOUT_MS=25000
    LLM_STREAM=1
    LLM_ROUTER_ENABLED=1
    ENABLE_LLM=1

    EDIT_LLM_ENABLED=1
    EDIT_LLM_PROVIDER=... (default: baseten)
    EDIT_LLM_MODEL=... (overrides provider default)
    EDIT_LLM_TEMPERATURE=0.6
    EDIT_LLM_TIMEOUT_MS=25000
    EDIT_LLM_STREAM=1

    OPENAI_API_KEY, GROQ_API_KEY, BASETEN_API_KEY, OPENROUTER_API_KEY
  </env_vars>
</llm>

---

## Text Insertion

<native file="native/sonic-helper.c">
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

Comprehensive timing instrumentation across client and server.

<metrics>
  <client file="src/hooks/useTranscription.ts:71-92">
    sessionId, pttDownMs, stopInvokedMs, wsOpenMs, firstFrameOutMs,
    lastFrameOutMs, endSentMs, statusRecvMs, finalRecvMs,
    pasteStartMs, pasteDoneMs, postRollStartMs, postRollEndMs,
    drainDoneMs, framesProduced, bytesProduced, framesQueued, framesSentApprox
  </client>

  <server>
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
  </derived>

  <logging>
    Client logs single consolidated line:
    console.log("[SF] E2E", { traceId, dictationMs, e2eMs, totalMs, sttMs, llmMs, pasteMs, ... })

    Worker logs session summary with all timing data.
    Both correlated via traceId for end-to-end visibility.
  </logging>
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
  To switch providers, simply update the default provider constant. The system will automatically select the appropriate default model:

  ```typescript
  // Switch LLM provider (e.g., from 'groq' to 'openai')
  // The default model is automatically selected based on the provider!
  export const LLM_DEFAULT_PROVIDER = 'openai' as const;

  // Switch STT provider
  export const STT_DEFAULT_PROVIDER = 'deepgram' as const;
  ```

  This design allows for:
  - **Rapid Prototyping**: Test new providers by changing one line.
  - **Provider redundancy**: If one provider goes down, switch to another instantly.
  - **A/B Testing**: Easily configure different environments with different providers.

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
    Local storage only. Database (dictation_logs) stores metadata, NOT text.
    User has full control over their transcription history.
  </privacy>
</history>

---

**Last Updated**: 2025-11-30
**Pipeline Version**: Includes edit mode, multi-provider support, vocabulary enhancement
