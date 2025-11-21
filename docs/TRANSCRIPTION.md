# Sonic Flow App - Transcription Pipeline - docs/TRANSCRIPTION.md

This document provides a comprehensive technical overview of Sonic Flow's real-time audio transcription pipeline, from microphone capture to text insertion.

## Table of Contents
1. [Pipeline Overview](#pipeline-overview)
2. [Audio Capture & Processing](#audio-capture--processing)
3. [WebSocket Protocol](#websocket-protocol)
   - [Edit Mode Metadata](#edit-mode-metadata)
4. [Server-Side Processing](#server-side-processing)
   - [Edit Mode LLM Flow](#edit-mode-llm-flow)
5. [Response Handling](#response-handling)
6. [Performance Metrics](#performance-metrics)
7. [Error Handling](#error-handling)
8. [Configuration](#configuration)
   - [Edit Mode LLM Settings](#edit-mode-llm-settings)

---

## Pipeline Overview

The transcription pipeline consists of six main stages:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Microphone    │───▶│   Audio         │───▶│   WebSocket     │
│   Capture       │    │   Processing    │    │   Streaming     │
│   (getUserMedia)│    │   (Worklet)     │    │   (Binary)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Text          │◀───│   Response      │◀───│   Server        │
│   Insertion     │    │   Processing    │    │   Processing    │
│   (Native)      │    │   (React)       │    │   (Worker)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**End-to-End Flow:**
1. **Audio Capture**: Microphone stream via `getUserMedia()` at device native rate (typically 48kHz)
2. **Audio Processing**: Real-time resampling to 16kHz PCM16 using Web Audio API worklet
3. **WebSocket Streaming**: Binary frame transmission with headers to Cloudflare Worker
4. **Server Processing**: PCM concatenation, WAV wrapping, and Groq API transcription
5. **Response Processing**: Real-time UI updates and final result handling
6. **Text Insertion**: Native macOS accessibility API text insertion at cursor position

---

## Audio Capture & Processing

### Microphone Stream Configuration

**Location**: `src/hooks/useTranscription.ts:425-503`

The pipeline starts by requesting microphone access with echo cancellation disabled, but noise suppression and auto gain enabled:

```typescript
const constraints: MediaStreamConstraints = {
  audio: {
    sampleRate: MICROPHONE_PREFERRED_RATE,    // 48000 Hz
    channelCount: 1,                          // Mono
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: false,
  },
};
```

**Key Features**:
- Device-specific targeting when user selects non-default microphone
- Automatic device enumeration and permission management
- Real-time device change detection and stream reinitialization
- Constraint validation, `applyConstraints` enforcement, and actual settings logging

### Audio Processing Worklet

**Location**: `public/worklets/pcm16-downsampler.worklet.js`

The worklet performs real-time audio processing in a dedicated audio thread:

#### Resampling Modes
1. **Passthrough** (16kHz input): Direct Float32 → Int16 conversion
2. **Decimate-by-3** (48kHz → 16kHz): Optimized FIR low-pass filter with 31-tap Hamming window
3. **Linear Interpolation** (other rates): Generic resampling with anti-aliasing

#### Frame Buffering
```javascript
// Default configuration
frameSamples: 1600,     // 100ms at 16kHz
targetRate: 16000,      // ASR model expected rate
```

**Processing Flow**:
1. Receive Float32 samples from AudioContext (128-sample blocks at 48kHz)
2. Apply resampling algorithm based on input/output rate ratio
3. Convert to signed 16-bit PCM with clipping protection
4. Buffer samples until frame size reached (1600 samples default)
5. Post complete frames as transferable ArrayBuffers to main thread

#### Advanced Features
- **Flush Support**: Partial frame emission on recording stop to prevent audio loss
- **Reset Capability**: Clean state reset between sessions
- **Anti-aliasing**: Proper low-pass filtering for quality resampling
- **DC Gain Normalization**: Maintains consistent audio levels

---

## WebSocket Protocol

### Connection Management

**Location**: `src/hooks/useTranscription.ts:170-228`

The WebSocket connection implements sophisticated reliability features:

#### Connection Lifecycle
```typescript
const wsUrl = getTranscribeWsUrl();  // Environment-specific endpoint
const ws = new WebSocket(wsUrl);
ws.binaryType = "arraybuffer";       // Enable binary frame support
```

#### Reconnection Strategy
- **Exponential Backoff**: 150ms base delay, doubles each attempt (max 2s)
- **Circuit Breaker**: Max 10 attempts, then 60-second cooldown
- **Connection Pooling**: Reuses existing connections across sessions
- **State Validation**: Handles intermediate connection states properly

#### Flow Control
```typescript
const WS_MAX_BUFFERED_BYTES = 512 * 1024;  // 512KB backpressure threshold
```
- Client-side buffering when WebSocket buffer is full
- Queue flushing with 10ms retry intervals
- 20MB total buffer limit with graceful degradation

### Edit Mode Metadata

**Location**: `src/hooks/useTranscription.ts:353-421`, `worker/src/types/messages.ts:1-172`

Before every session, the renderer probes the macOS accessibility API for the currently selected text. If the helper returns a valid snapshot, the subsequent `start` control message includes both a `mode` flag and a serialized selection payload:

```json
{
  "type": "start",
  "version": 2,
  "mode": "edit",
  "selection": {
    "hadSelection": true,
    "text": "Original paragraph that will be edited",
    "range": { "location": 42, "length": 128 },
    "status": "read:ok",
    "source": "ax"
  }
}
```

Runtime details:
- When no selection is available (or the AX read fails) the hook falls back to `mode: "dictation"` and omits the `selection` field.
- The worker stores `mode` and `selection` in the session object, making the metadata available once the audio finishes streaming.
- Downstream logging (`dataset.llm_io`, Sentry spans) records the chosen mode so edit sessions can be analyzed separately.
- `selection.source` records where the text came from. The helper snapshots the clipboard, synthesizes Cmd+C using the same event sequencing as paste, waits for plain-text data, and restores the clipboard so the user never sees the temporary value. When that capture succeeds the source is `"clipboard"`; when the clipboard probe fails (for secure fields, etc.) the source is `"none"` and the session falls back to dictation.

### Binary Frame Protocol

**Location**: `src/utils/pcm.ts:5-22`

Each audio frame uses a structured 16-byte header followed by PCM data:

```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│   Sequence      │   Payload Size  │     Timestamp (Low)     │     Timestamp (High)    │
│   (4 bytes)     │   (4 bytes)     │     (4 bytes)   │     (4 bytes)   │
│   Little Endian │   Little Endian │   Little Endian │   Little Endian │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
│                               PCM16 Audio Data                        │
│                          (Payload Size bytes)                         │
└───────────────────────────────────────────────────────────────────────┘
```

#### Header Fields
- **Sequence (u32)**: Frame sequence number for gap detection
- **Payload Size (u32)**: Exact byte count of following PCM data  
- **Timestamp (u64)**: Client nanosecond timestamp (split into two u32)

#### Frame Generation
```typescript
export function encodeFrameHeader(seq: number, nbytes: number, tsNs: bigint): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const view = new DataView(buf);
  view.setUint32(0, seq >>> 0, true);      // Sequence
  view.setUint32(4, nbytes >>> 0, true);   // Payload size
  // Split 64-bit timestamp into two 32-bit little-endian values
  const lo = Number(tsNs & BigInt(0xffffffff));
  const hi = Number((tsNs >> BigInt(32)) & BigInt(0xffffffff));
  view.setUint32(8, lo >>> 0, true);       // Timestamp low
  view.setUint32(12, hi >>> 0, true);      // Timestamp high
  return buf;
}
```

### Message Types

#### Client → Server Messages
```typescript
// Session start
{
  "type": "start",
  "version": 2,
  "format": "pcm16le",
  "rate": 16000,
  "language": "en",
  "traceId": "abc123",
  "identity": {
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  }
}

// identity is optional. When provided, both strings are sanitized on the worker (control
// characters removed, angle brackets stripped, max length enforced) before being added to
// STT and LLM prompts.

// Session end (trigger transcription)
{ type: "end" }

// Session cancellation
{ type: "cancel" }
```

#### Server → Client Messages
```typescript
// Processing started
{ type: "status", state: "processing", traceId: "abc123", serverTs: 1640995200000 }

// LLM post-processing started  
{ type: "llm_status", state: "llm_processing", traceId: "abc123" }

// Progressive LLM text updates
{ type: "llm_delta", delta: "Hello", traceId: "abc123" }

// Final transcription result
{ 
  type: "final", 
  text: "Hello world", 
  traceId: "abc123",
  metrics: { worker: { ... } }
}

// Error condition
{
  type: "error",
  code: 4001,                    // Error code (4001=STT_API_ERROR, 4002=STT_TIMEOUT, etc.)
  body: "Transcription failed",
  retryable: false               // Whether client should retry
}
```

---

## Server-Side Processing

### WebSocket Handler

**Location**: `worker/src/handlers/ws.ts`

The Cloudflare Worker implements a production-ready WebSocket transcription service:

#### Connection Security
- **Rate Limiting**: Maximum 5 concurrent connections per IP address
- **Payload Limits**: 20MB maximum session size with early termination
- **DOS Protection**: Connection tracking with automatic cleanup

#### Session Management

**Location**: `worker/src/ws/session.ts`

```typescript
interface AudioSession {
  traceId: string;
  chunks: Uint8Array[];        // Accumulated PCM chunks
  totalBytes: number;          // Total audio data size
  frames: number;              // Frame count received
  seqGaps: number;             // Sequence gap count
  firstArrivalMs: number;      // First frame timestamp
  lastArrivalMs: number;       // Last frame timestamp
  // ... additional timing fields
}
```

#### Frame Processing
1. **Header Parsing**: Extract sequence, size, and timestamp from 16-byte header
2. **Payload Validation**: Verify payload size matches header declaration
3. **Gap Detection**: Track sequence numbers to identify dropped frames
4. **Size Enforcement**: Reject sessions exceeding 20MB limit
5. **Chunk Accumulation**: Store PCM data for final assembly

### Audio Assembly

**Location**: `worker/src/audio/codec.ts:9-17`

```typescript
export function concat(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
```

### WAV File Generation

**Location**: `worker/src/audio/codec.ts:19-51`

The server wraps raw PCM data in a proper WAV container for Groq API compatibility:

```typescript
export function wrapWav(pcm: Uint8Array, rate = 16000, channels = 1, bitsPerSample = 16): Uint8Array {
  // Standard WAV header construction (44 bytes)
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  
  // RIFF chunk
  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeStr(view, 8, 'WAVE');
  
  // Format chunk
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                    // Chunk size
  view.setUint16(20, 1, true);                     // PCM format
  view.setUint16(22, channels, true);              // Channel count
  view.setUint32(24, rate, true);                  // Sample rate
  view.setUint32(28, byteRate, true);              // Byte rate
  view.setUint16(32, blockAlign, true);            // Block align
  view.setUint16(34, bitsPerSample, true);         // Bits per sample
  
  // Data chunk
  writeStr(view, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);        // Data size
  
  // Combine header + PCM data
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}
```

### Speech-to-Text Providers

The worker now supports multiple STT providers behind a small dispatcher so the default can be flipped by editing `worker/src/config.ts` (no `.dev.vars` required).

- **Switcher**: `worker/src/services/stt/index.ts` — selects provider based on `STT_DEFAULT_PROVIDER` and forwards normalized options.
- **Provider configs**: default provider/model live in `worker/src/config.ts`, while the runtime `STT_PROVIDER` env (or the config fallback) selects the active service without touching `.dev.vars`.

#### Groq Whisper Large v3 Turbo (default)
- **Location**: `worker/src/services/stt/providers/groq.ts`
- **Endpoint**: `https://api.groq.com/openai/v1/audio/transcriptions`
- **Auth**: `Authorization: Bearer <GROQ_API_KEY>`
- **Default model**: `whisper-large-v3-turbo` (set via `GROQ_STT_MODEL`)
- **Instrumentation**: Records `stt.provider = groq` plus Groq-specific timing attributes for TTFB, body processing, and total duration.

#### Fireworks Whisper Turbo
- **Location**: `worker/src/services/stt/providers/fireworks.ts`
- **Endpoint**: `https://audio-turbo.us-virginia-1.direct.fireworks.ai/v1/audio/transcriptions`
- **Auth**: `Authorization: <FIREWORKS_API_KEY>` (no `Bearer` prefix)
- **Default model**: `whisper-v3-turbo` (via `FIREWORKS_STT_TURBO_MODEL`)
- **Signal options**: Uses fallback decoding with `temperature=0.0,0.2,0.4`, `vad_model=silero`, `alignment_model=tdnn_ffn`, and `preprocessing=none` for minimal latency; language defaults to `en` unless overridden.
- **Instrumentation**: Emits `stt.provider = fireworks` with timing metrics mirroring the Groq span fields.

#### Deepgram Nova (punctuation + paragraphs)
- **Location**: `worker/src/services/stt/providers/deepgram.ts`
- **Endpoint**: `https://api.deepgram.com/v1/listen`
- **Auth**: `Authorization: Token <DEEPGRAM_API_KEY>`
- **Default model**: `nova-3` (via `DEEPGRAM_STT_DEFAULT_MODEL`)
- **Query params**: Sends only `model` and `language` so the service applies its own defaults.
- **Instrumentation**: Emits `stt.provider = deepgram` plus Deepgram-specific timing and transcript attributes, matching the structure used by other providers.

> **Switching providers**: Set `STT_PROVIDER=fireworks` or `STT_PROVIDER=deepgram` (and supply the matching API key) to flip at runtime. The WebSocket handler logs the active provider/model combo so you can confirm the change in devtools.

### Hallucination Post-Processing

**Location**: `worker/src/services/stt/postprocess.ts`

After STT transcription, the result passes through a hallucination filter that removes common Whisper artifacts from YouTube training data:

```typescript
const HALLUCINATION_PATTERNS = [
  /[Tt]hank you for watching!$/,              // YouTube outro
  /Subtitles by the Amara\.org community\.$/,  // Amara subtitles
];
```

**Behavior**:
- Patterns are matched at the end of the transcription text
- If the entire transcription is only a hallucination phrase, it is NOT removed (allows user to retry)
- The filter is applied automatically after every STT call in `worker/src/services/stt/index.ts`

### Edit Mode LLM Flow

**Location**: `worker/src/handlers/ws.ts:200-360`, `worker/src/services/llm/editPrompt.ts`

Edit sessions use the STT output as an instruction string rather than the final text. The worker then:

1. Calls `prepareEditRequest` to build a plain-text prompt with labelled “Instructions” and “Original Text” sections.
2. Sends the prompt to the configured edit model (GPT‑4.1 by default) with a strict system prompt that requests the rewritten text only.
3. Streams edit deltas back to the renderer when `EDIT_LLM_STREAM=1`, otherwise returns a single edited block.
4. Falls back to the original selection if the edit request errors or the provider key is missing (recorded as `edit.api_key_missing`).

Every edit invocation emits additional Sentry attributes (`edit.instructions_length`, `edit.provider`, `edit.had_selection`, etc.) and reuses the existing dataset logging pipeline so analytics can compare dictation and edit flows side-by-side.

### Optional LLM Post-Processing

The worker can optionally run the final STT text through an LLM “clean‑up” step. Multiple providers are supported with streaming deltas:

#### Providers
- Groq: chat completions (OpenAI‑compatible)
- OpenAI: chat completions (SSE streaming)
- Baseten (Base Ten): chat completions (OpenAI‑compatible, SSE streaming)
- OpenRouter: chat completions (SSE streaming, multi-provider routing)
- Kimi (via length routing): automatically selected for long-form cleanups (≥1200 chars or ≥180 words)

#### Configuration
```bash
# Enable / behavior
ENABLE_LLM=1                       # Enable post-processing (default true)
LLM_STREAM=1                       # Stream progressive updates when supported (default true)
LLM_MODEL=deepseek-ai/DeepSeek-V3.1  # Model to use (see provider notes)
LLM_TEMPERATURE=0.2                # Optional; defaults to 0.2
LLM_TIMEOUT_MS=25000               # Optional; defaults to 25000
LLM_CURRENT_DATE=YYYY-MM-DD        # Optional; defaults to today (UTC)
LLM_ROUTER_ENABLED=1               # Enable routing rules (default true)

# Provider selection
LLM_PROVIDER=baseten               # One of: openai | groq | baseten | openrouter
LLM_DEFAULT_PROVIDER=baseten       # Fallback when LLM_PROVIDER is unset

# API keys (set the one(s) for the provider you use)
OPENAI_API_KEY=sk-...              # Required when provider=openai
GROQ_API_KEY=gk-...                # Required when provider=groq
BASETEN_API_KEY=bt-...             # Required when provider=baseten
OPENROUTER_API_KEY=...             # Required when provider=openrouter
```

Notes
- Provider, model, temperature, and streaming behavior are read at runtime (see `worker/src/config/runtime.ts`).
- Endpoints and defaults live in `worker/src/config.ts` and can be adjusted if needed.

#### Progressive Streaming
When enabled, the worker streams LLM improvements in real-time:
1. Send `llm_status` message when LLM processing starts
2. Stream `llm_delta` messages with text chunks as they arrive
3. Final result contains complete enhanced text

#### Routing Rules
`worker/src/services/llm/routing.ts` first checks regex-driven heuristics (spelling requests, formatting directives, etc.) and now also applies a length guard. Any transcript that meets either threshold—≥1200 characters or ≥180 words—routes to the edit model for the current provider (e.g., `moonshotai/Kimi-K2-Instruct-0905` for Baseten) so longer dictations stay within high token limits. Matched rule IDs (including `length-threshold`) are appended when reporting the decision.

Routing can be disabled with `LLM_ROUTER_ENABLED=0`.

---

## Response Handling

### Client Message Processing

**Location**: `src/hooks/useTranscription.ts:667-853`

The client implements sophisticated response handling with comprehensive error recovery:

#### Message Handlers
```typescript
const onMessage = async (event: MessageEvent) => {
  const msg = JSON.parse(String(event.data));
  
  if (msg.type === "status" && msg.state === "processing") {
    // STT processing started - record timing
    metricsRef.current.sttStartMs = performance.now();
    
  } else if (msg.type === "llm_status" && msg.state === "llm_processing") {
    // LLM processing started
    
  } else if (msg.type === "llm_delta" && typeof msg.delta === "string") {
    // Progressive UI update (paste still happens on final)
    setText(prev => {
      const next = (prev || "") + msg.delta;
      window.transcript?.update(next);  // Update UI
      return next;
    });
    
  } else if (msg.type === "final") {
    // Complete transcription received
    setText(msg.text || "");
    window.transcript?.update(msg.text);
    
    // Insert text at cursor via native helper
    await window.clipboard.insertText(msg.text);
    
    // Process metrics and close connection
    // ...
  }
};
```

#### Error Handling
- **Timeout Protection**: 15-second maximum wait for response
- **Connection Recovery**: Automatic reconnection on WebSocket errors
- **Graceful Degradation**: Continue with partial results on non-critical failures
- **User Feedback**: Clear error messages with actionable guidance

### Text Insertion

**Location**: `native/sonic-helper.c`

The native helper provides system-level text insertion using macOS Accessibility APIs:

#### Process Flow
1. **Focus Detection**: Identify the currently focused application and UI element
2. **Accessibility Check**: Verify text insertion permissions and element capabilities  
3. **Text Insertion**: Use `Cmd+V` simulation with clipboard manipulation
4. **Verification**: Optional accessibility-based verification of successful insertion

#### Key Features
- **Universal Compatibility**: Works with any text field accepting keyboard input
- **Permission Handling**: Graceful degradation when accessibility permissions unavailable
- **Performance Optimization**: Pre-spawned daemon reduces insertion latency by ~25ms

---

## Performance Metrics

### Comprehensive Timing Instrumentation

**Location**: `src/hooks/useTranscription.ts:71-92`

The pipeline includes detailed performance monitoring across all stages:

#### Client-Side Metrics
```typescript
interface TranscriptionMetrics {
  sessionId: string;
  pttDownMs: number;              // PTT button press
  stopInvokedMs: number;          // PTT button release  
  wsOpenMs: number;               // WebSocket connection established
  firstFrameOutMs: number;        // First audio frame sent
  lastFrameOutMs: number;         // Last audio frame sent
  endSentMs: number;              // "end" message sent
  statusRecvMs: number;           // "status" message received
  finalRecvMs: number;            // "final" message received
  pasteStartMs: number;           // Text insertion started
  pasteDoneMs: number;            // Text insertion completed
  postRollStartMs: number;        // Post-roll capture started
  postRollEndMs: number;          // Post-roll capture ended
  drainDoneMs: number;            // Frame queue drain completed
  
  // Counters
  framesProduced: number;         // Total frames generated
  bytesProduced: number;          // Total audio bytes
  framesQueued: number;           // Frames queued (buffered)
  framesSentApprox: number;       // Frames sent successfully
}
```

#### Server-Side Metrics
```typescript
interface WorkerMetrics {
  traceId: string;
  wsAcceptAt: number;             // WebSocket connection accepted
  startedAt: number;              // Session start message received
  processingStartAt: number;      // "end" message received
  frames: number;                 // Total frames received
  bytes: number;                  // Total bytes received
  seqGaps: number;                // Sequence gaps detected
  firstArrivalMs: number;         // First frame arrived
  lastArrivalMs: number;          // Last frame arrived
  assembleMs: number;             // PCM→WAV assembly time
  
  // STT timing breakdown
  groq: {
    startAt: number;              // API request initiated
    headersAt: number;            // Response headers received
    bodyDoneAt: number;           // Response body parsed
    ttfbMs: number;               // Time to first byte
    bodyMs: number;               // Body processing time  
    totalMs: number;              // Total API call time
  };
}
```

#### Derived Performance Indicators
```typescript
// End-to-end latency breakdown (split)
const breakdown = {
  // New split: separate user speech duration from system latency
  dictationMs: stopInvokedMs - pttDownMs,            // How long the user dictated
  e2eMs: pasteDoneMs - stopInvokedMs,                // Post-dictation latency (hotkey up -> paste)
  totalMs: pasteDoneMs - pttDownMs,                  // Full session (legacy total)

  wsOpenMs: wsOpenMs - pttDownMs,                    // Connection setup
  captureMs: (postRollMs + drainMs),                 // Audio capture overhead (tail + drain)
  endToStatusMs: statusRecvMs - endSentMs,           // Server response latency
  sttMs: groq.totalMs,                               // Speech-to-text processing
  deliverMs: finalRecvMs - statusRecvMs - sttMs,     // Result delivery
  pasteMs: pasteDoneMs - finalRecvMs,                // Text insertion time

  // Quality metrics
  frames: framesProduced,
  bytesKB: bytesProduced / 1024,
  seqGaps: seqGaps,                                  // Connection quality
};
```

### Consolidated Logging

**Location**: `src/hooks/useTranscription.ts:813-829`

All metrics are consolidated into a single structured log entry for easy analysis:

```javascript
console.log("[SF] E2E", {
  traceId: "abc123",
  // Split metrics
  dictationMs: 1620,     // User talk time
  e2eMs: 1227,           // Post-dictation latency (stop -> paste)
  totalMs: 2847,         // Full session

  wsOpenMs: 145,         // Connection setup  
  captureMs: 170,        // Audio processing overhead
  endToStatusMs: 89,     // Server response time
  sttMs: 1205,           // Groq API processing
  deliverMs: 34,         // Response delivery
  pasteMs: 25,           // Native text insertion
  frames: 42,            // Audio frames sent
  bytesKB: 134.4,        // Audio data size
  seqGaps: 0,            // Connection quality (0 = perfect)
});
```

This single log line provides complete visibility into performance across the entire pipeline.

---

### Merged Summary Payload (with Dataset)

When the server sends the final result, it includes `dataset: { sttText, llmText }`. The client forwards this to `/metrics/session`, and the Worker emits a merged `transcription.session_summary` with the dataset attached. The Sentry span is also enriched with `dataset.stt_text`/`dataset.llm_text`.

Example merged summary:

```
{
  "event": "transcription.session_summary",
  "id": "abc123",
  "pipeline": "stt+llm",
  "durations": {
    "e2eMs": 960,
    "dictationMs": 3156,
    "totalMs": 4116,
    "captureMs": 242,
    "deliverMs": 357,
    "pasteMs": 0,
    "wsAcceptToFinalMs": 4200,
    "assembleMs": 1,
    "sttMs": 357,
    "llmMs": 253,
    "serverProcessingMs": 610,
    "overheadMs": 3
  },
  "traffic": { "frames": 34, "bytesKB": 103.22, "seqGaps": 0, "firstToLastArrivalMs": 3220 },
  "result": { "textLen": 49 },
  "dataset": { "sttText": "...", "llmText": "..." },
  "ws": { "closeCode": 1000, "closeReason": "done" }
}
```

Privacy note: dataset includes full text; comment out the dataset logging block in `worker/src/handlers/ws.ts` if you need to disable.

## Error Handling

### Multi-Layer Error Recovery

#### Connection Layer
- **WebSocket Errors**: Automatic reconnection with exponential backoff
- **Network Interruptions**: Client-side buffering with overflow protection
- **Server Unavailable**: Circuit breaker prevents excessive retry attempts

#### Audio Layer  
- **Device Errors**: Graceful fallback to default microphone
- **Permission Denied**: Clear user guidance for microphone access
- **Stream Interruption**: Automatic stream reinitialization

#### Processing Layer
- **Server Errors**: Detailed error messages with context
- **API Failures**: Timeout protection with proper cleanup
- **Invalid Responses**: JSON parsing with error boundaries

#### User Experience
- **Progressive Enhancement**: Core functionality works even with degraded performance
- **Clear Feedback**: Specific error messages with actionable steps
- **Graceful Degradation**: Partial functionality when full pipeline unavailable

### Cancellation Support

The pipeline supports clean cancellation at any stage:

```typescript
const cancel = useCallback(async () => {
  // Abort any in-flight processing
  abortControllerRef.current?.abort();
  
  // Disconnect audio processing
  sourceNodeRef.current?.disconnect();
  workletNodeRef.current?.disconnect();
  audioContextRef.current?.close();
  
  // Clean up WebSocket connection
  if (wsRef.current?.readyState === WebSocket.OPEN) {
    wsRef.current.send(JSON.stringify({ type: "cancel" }));
  }
  wsRef.current?.close(1000, "cancel");
  
  // Reset all state
  setRecording(false);
  setProcessing(false);
  resetReconnectBackoff();
}, []);
```

---

## Configuration

### Audio Configuration

**Location**: `src/config/audio.ts`

```typescript
// Sample rates
export const MICROPHONE_PREFERRED_RATE = 48000;   // Hardware capture rate
export const TARGET_SAMPLE_RATE = 16000;          // ASR model rate

// Frame configuration
export const CHUNK_MS = 100;                      // Frame duration
export const SAMPLES_PER_CHUNK = 1600;            // 100ms @ 16kHz
export const POST_ROLL_MS = 240;                  // End-of-speech capture

// WebSocket configuration
export const WS_MAX_BUFFERED_BYTES = 512 * 1024;  // Backpressure threshold
```

### Environment Variables

```bash
# Development
SF_DEVTOOLS=1                           # Enable dev console logs
VITE_TRANSCRIBE_WS_URL=ws://localhost:8787/ws  # Local worker endpoint

# Production  
VITE_TRANSCRIBE_WS_URL=wss://api.sonicflow.app/ws  # Production endpoint
VITE_SENTRY_DSN=...                     # Error reporting

# Worker configuration - STT
STT_PROVIDER=groq                       # groq | fireworks | deepgram (default: groq)
STT_MODEL=whisper-large-v3-turbo        # Override default model for provider
STT_PROMPT=...                          # Custom STT prompt (optional)
STT_LANGUAGE=en                         # Language code (default: en)
STT_TIMEOUT_MS=25000                    # STT request timeout (default: 25000)
GROQ_API_KEY=...                        # Required for Groq STT or Groq LLM
FIREWORKS_API_KEY=...                   # Required when STT_PROVIDER=fireworks
DEEPGRAM_API_KEY=...                    # Required when STT_PROVIDER=deepgram

# Worker configuration - LLM
LLM_PROVIDER=baseten                    # openai | groq | baseten | openrouter
LLM_DEFAULT_PROVIDER=baseten            # Fallback when LLM_PROVIDER is unset
LLM_MODEL=deepseek-ai/DeepSeek-V3.1     # Model to use per provider
LLM_ROUTER_ENABLED=1                    # Enable routing rules (default true)
ENABLE_LLM=1                            # Enable post-processing (default true)
LLM_STREAM=1                            # Stream progressive updates (default true)
OPENAI_API_KEY=...                      # When provider=openai
BASETEN_API_KEY=...                     # When provider=baseten
OPENROUTER_API_KEY=...                  # When provider=openrouter
```

### Edit Mode LLM Settings

```bash
EDIT_LLM_ENABLED=1                      # Enable edit-mode rewriting (default true)
EDIT_LLM_PROVIDER=baseten               # Provider for edits (openai | groq | baseten | openrouter)
EDIT_LLM_MODEL=moonshotai/Kimi-K2-Instruct-0905  # Editing model
EDIT_LLM_STREAM=1                       # Stream edit deltas when provider supports SSE
EDIT_LLM_TEMPERATURE=0.6                # Creativity dial for edits (default 0.6)
EDIT_LLM_TIMEOUT_MS=25000               # Timeout for editing request (default 25s)
```

> **API Keys**: When `EDIT_LLM_PROVIDER=openai`, the worker requires `OPENAI_API_KEY`. For Groq/Baseten/OpenRouter supply the corresponding API key. Missing credentials are logged (`edit.api_key_missing`) and the original selection is returned unchanged.

### Performance Tuning

#### Client Optimizations
- **Frame Size**: 100ms frames balance responsiveness with protocol overhead
- **Connection Reuse**: WebSocket connections persist across sessions
- **Buffering Strategy**: 20MB client buffer prevents data loss
- **Post-roll Capture**: 240ms prevents end-of-speech clipping

#### Server Optimizations  
- **Connection Limits**: 5 connections per IP prevents resource exhaustion
- **Payload Limits**: 20MB session limit prevents memory issues
- **Early Termination**: Oversized sessions rejected immediately
- **Structured Logging**: Efficient debugging with trace correlation

---

## Debugging

### Development Flags

```bash
SF_DEVTOOLS=1 npm run dev    # Enable detailed console logging
```

### Client-Side Debugging
- **Pill State**: Add `?debugPill` to URL for state machine visualization
- **Metrics Logging**: All timing data logged to browser console
- **Connection State**: WebSocket state changes logged with context

### Server-Side Debugging
- **Trace IDs**: Correlate client/server logs via trace identifiers  
- **Structured Logging**: JSON-formatted logs with consistent fields
- **Session Metrics**: Complete session data logged on completion

### Common Issues
- **End-of-speech clipping**: Resolved via POST_ROLL_MS capture
- **Connection drops**: Handled by exponential backoff reconnection
- **Large audio sessions**: Protected by 20MB payload limits
- **Native helper failures**: Graceful degradation with user feedback

This transcription pipeline provides production-ready real-time speech-to-text with comprehensive error handling, performance monitoring, and optimization features designed for low-latency user interaction.
