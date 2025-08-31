# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Cloudflare Worker component of Sonic Flow, a real-time audio transcription service. The worker provides WebSocket-based audio streaming and transcription using the Groq API, serving as the backend for the main Electron application.

## Key Commands

### Development
- `npm run dev` or `npm run start` - Start local development server on port 8787
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run cf-typegen` - Generate Cloudflare Worker types

### Testing
- Tests are colocated with source files (e.g., `codec.test.ts`, `groq.test.ts`, `messages.test.ts`)
- Run tests from parent directory: `npm run test` (uses Vitest)

## Architecture Overview

### WebSocket Audio Transcription Service
The worker implements a real-time audio transcription pipeline:

1. **WebSocket Connection** (`src/handlers/ws.ts`) - Handles client connections with DOS protection (max 5 connections per IP)
2. **Binary Audio Protocol** - Receives PCM16@16kHz audio in 16-byte header frames
3. **Audio Processing** (`src/audio/codec.ts`) - Concatenates chunks and wraps as WAV format
4. **Speech-to-Text** (`src/services/stt/groq.ts`) - Transcribes via Groq's Whisper API
5. **LLM Post-Processing** (`src/services/llm/groq.ts`) - Optional AI enhancement using Groq chat models
6. **Session Management** (`src/ws/session.ts`) - Tracks connection state and metrics

### Key Components

#### WebSocket Protocol (`src/types/messages.ts`)
- **Client Messages**: `start`, `end`, `cancel` with session configuration
- **Server Messages**: `status` (processing), `llm_status` (LLM processing), `llm_delta` (streaming LLM output), `final` (transcription result), `error`
- **Binary Frames**: 16-byte headers containing sequence, payload size, and timestamp

#### Audio Processing (`src/audio/codec.ts`)
- Frame header parsing: `u32 seq | u32 nbytes | u64 timestamp`
- PCM chunk concatenation with sequence gap detection
- WAV file wrapping for Groq API compatibility
- 20MB max payload size limit

#### Connection Management (`src/utils/connLimit.ts`)
- Per-IP connection tracking with 5 connection limit
- Automatic cleanup on connection close/error
- DOS protection against connection flooding

#### Session Tracking (`src/ws/session.ts`)
- Audio session state management
- Comprehensive metrics collection (timing, bytes, sequence gaps)
- Structured logging with trace IDs for debugging

### Error Handling and Connection Lifecycle
- Standardized WebSocket close codes (1000=success, 1009=payload too large, 1011=server error)
- Graceful connection cleanup with automatic resource release
- Session deduplication to prevent multiple active sessions
- Proper AbortController usage for request cancellation

## Configuration

### Environment Variables
- `GROQ_API_KEY` — Required for STT and LLM (dashboard secret)
- `ENABLE_LLM` — Enable post-LLM cleanup (`true|false`, default: true)
- `LLM_STREAM` — Stream deltas to client (`true|false`, default: true)
- `LLM_MODEL` — Chat model id (default from `src/config.ts`)
- `LLM_CURRENT_DATE` — Optional ISO date (YYYY-MM-DD) inserted in system prompt; defaults to today (UTC)
- `LLM_TIMEOUT_MS` — LLM request timeout override
- `STT_MODEL` — STT model id (default from `src/config.ts`)
- `STT_LANGUAGE` — Default language (client may override in `start`)
- `STT_PROMPT` — Optional STT vocab/prompt override
- `STT_TIMEOUT_MS` — STT request timeout override

### Wrangler Configuration (`wrangler.jsonc`)
- Custom domain: `api.sonicflow.app`
- Smart placement enabled for optimal performance
- Node.js compatibility mode enabled
- Observability enabled for monitoring

### TypeScript Configuration
- Target: ES2022 with WebWorker libs
- Strict mode enabled with null checks
- Custom worker type definitions in `worker-configuration.d.ts`

## Development Patterns

### Message Flow
1. Client sends `start` message with session config
2. Client streams binary audio frames with headers
3. Client sends `end` to trigger transcription
4. Worker transcribes audio via Groq STT API
5. Optional: Worker processes transcription through LLM for enhancement using `buildLLMSystemPrompt({ model, currentDate })`
6. Worker sends streaming LLM deltas (if enabled) and final result
7. Connection closes with appropriate status code

### Error Recovery
- Session state reset on errors
- Connection cleanup on abort/timeout
- Automatic resource release (AbortController, connection tracking)
- Comprehensive error logging with context

### Performance Optimizations
- Session reuse within single connection
- Efficient byte array concatenation
- Streaming response processing with timing metrics
- Connection pooling limits to prevent resource exhaustion

## Testing and Debugging

### Local Development
- Run `npm run dev` to start local server
- WebSocket endpoint available at `ws://localhost:8787/ws`
- Health check endpoint at `http://localhost:8787/`

### Logging and Metrics
- Structured logging with IP and trace ID context
- Comprehensive session metrics (frames, bytes, timing)
- Groq API timing breakdown (TTFB, body processing) for both STT and LLM (Sentry spans unchanged by config refactors)
- Automatic session lifecycle logging
- Sentry integration for error tracking and performance monitoring

### Connection Testing
- Test connection limits by opening multiple WebSocket connections
- Verify proper cleanup by monitoring connection tracker state
- Test audio processing with various payload sizes and formats

## Deployment

### Production Deployment
- `npm run deploy` deploys to Cloudflare Workers
- Requires `GROQ_API_KEY` secret configured in Cloudflare dashboard
- Custom domain routing configured for `api.sonicflow.app`
- Smart placement optimizes global performance

### Monitoring
- Cloudflare Workers analytics for request metrics
- Built-in observability for error tracking
- Custom metrics via session logging for transcription performance
- Session summary endpoint at `/metrics/session` for client-side E2E metrics correlation
- Sentry logs integration with structured logging for debugging
