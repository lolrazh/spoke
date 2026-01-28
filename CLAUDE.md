# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development Workflow
- `npm run dev` - Start development with devtools enabled
- `npm run dev:local` - Development with local HTTP server (http://127.0.0.1:8787)
- `npm run dev:prod` - Development with production HTTP server (https://api.spoke.so)
- `npm run dev:ws` - Start Cloudflare Worker locally (required for transcription)

### Testing & Code Quality
- `npm run test` - Run all tests with Vitest
- `npm run test:watch` - Run tests in watch mode for development
- `npm run coverage` - Run tests with coverage report
- `npm run lint` - ESLint TypeScript files

### Building & Packaging
- `npm run package` - Build and package for arm64 architecture
- `npm run make` - Create distributable DMG for arm64
- `npm run clean` - Clean build artifacts

### Staging & Production
- `npm run stage:local:package` - Staging build with local HTTP server
- `npm run stage:prod:package` - Staging build with production HTTP server
- `npm run publish` - Publish to Cloudflare R2 (requires .env configuration)

## Architecture Overview

Spoke is a macOS dictation app built with Electron, React, and TypeScript. The architecture consists of:

### Core Components
1. **Electron Main Process** (`src/main.ts`) - Window management, native integration, authentication
2. **React Renderer** (`src/components/App.tsx`) - Glassmorphic pill UI with state machine pattern
3. **Cloudflare Worker** (`worker/src/`) - HTTP-based transcription service with modular pipeline architecture
4. **Native Helper** (`native/spoke-helper.c`) - macOS accessibility API integration for text insertion

### Pill State Machine
The UI follows a state machine pattern with states: `"IDLE" | "LISTENING" | "PROCESSING" | "NOTIFICATION" | "HOVER_PREVIEW" | "EXPANDED"`

### Audio Pipeline
- HTTP upload-based transcription with two endpoints: `/prepare` (pre-flight) and `/transcribe` (upload)
- Browser-native MediaRecorder API with Opus/WebM compression (~10x vs PCM16)
- True parallelization: `/prepare` + recording start simultaneously
- Modular pipeline architecture:
  - `worker/src/middleware/` - CORS, auth, request ID middleware
  - `worker/src/handlers/http.ts` - HTTP request handlers for `/prepare` and `/transcribe`
  - `worker/src/pipeline/transcribe.ts` - STT orchestration (Opus decoding, API calls)
  - `worker/src/pipeline/router.ts` - Bypass/LLM decision (trigger detection)
  - `worker/src/pipeline/enhance.ts` - LLM enhancement (lazy loaded for 90% bypass case)
  - `worker/src/pipeline/ocr.ts` - OCR extraction (async with executionCtx)
  - `worker/src/background/tasks.ts` - Quota increment, analytics logging
  - `src/utils/audioRecorder.ts` - Client-side audio recording utility
- Groq Whisper-large-v3 model for transcription (STT)

### Authentication
- Supabase authentication with Google OAuth
- Custom protocol handler `spoke://` for deep linking
- Environment adaptive: HTTP callback (dev) vs hosted page (prod)

## Key Directories

- `src/components/` - React components (App.tsx contains main pill state machine)
- `src/hooks/` - Custom React hooks (useTranscription.ts for HTTP-based audio recording and upload)
- `src/config/` - Configuration constants and API endpoints
- `src/utils/` - Utility functions (logger, auth signals, audioRecorder)
- `worker/src/` - Cloudflare Worker for HTTP-based transcription
- `native/` - C binary for macOS accessibility integration
- `docs/` - Comprehensive documentation:
  - `AUTH.md` - Authentication flow and token handling
  - `DATABASE.md` - Supabase schema, RLS policies, and queries
  - `DESIGN.md` - UI/UX design specifications
  - `INSTRUMENTATION.md` - Sentry setup for app and worker
  - `PERMISSIONS.md` - macOS permissions architecture
  - `TRANSCRIPTION.md` - Audio pipeline and transcription flow
  - `USER_METRICS.md` - Analytics and telemetry system
  - `UPDATE_PIPELINE.md` - Auto-update process

## Environment Variables

### Development
- `SF_DEVTOOLS=1` - Enable development console
- `VITE_TRANSCRIBE_URL` - HTTP endpoint base URL (local: http://127.0.0.1:8787, prod: https://api.spoke.so)
- `FORCE_ONBOARDING=1` - Force onboarding flow
- `SKIP_AUTH=1` - Skip authentication for testing

### Production
- `VITE_SENTRY_DSN` - Error reporting DSN
- `VITE_SENTRY_ENVIRONMENT` - Environment tag (staging/production)

### Worker
- `GROQ_API_KEY` - Required for transcription service

## Testing Strategy

- **Unit Tests**: Component and utility testing with Vitest and happy-dom
- **Integration Tests**: End-to-end audio pipeline testing
- **Native Testing**: Helper binary functionality validation
- Test files follow `*.test.ts` or `*.test.tsx` naming convention
- Test setup in `src/test/setup.ts` with mocked MediaRecorder and audio utilities

## Native Development

The app includes a native C helper for text insertion via macOS Accessibility APIs:
- Build script: `native/build-helper.sh` (runs automatically on npm install)
- Requires Xcode Command Line Tools for compilation
- Test utilities: `./test-ax`, `./debug-focus`, `./check-editable`

## HTTP Protocol

Simple REST-based protocol for audio upload and transcription:
- **POST /prepare**: Pre-flight request with optional screenshot for OCR context
- **POST /transcribe**: Upload Opus/WebM audio via FormData with metadata
- True parallelization: `/prepare` starts with recording, completes before `/transcribe`
- Handled in `src/hooks/useTranscription.ts` (client) and `worker/src/handlers/http.ts` (server)

## Database (Supabase)

PostgreSQL database for user data and telemetry:

### Tables
- `profiles` - User profiles (1:1 with auth.users): display_name, avatar_url, onboarding_done, share_transcriptions
- `dictation_logs` - Telemetry per session: timing metrics, provider info, word count (no text stored)
- `waitlist` - Pre-launch email collection

### Key Functions (`src/lib/supabaseClient.ts`)
- `getProfile()` / `ensureProfileRow()` - Profile CRUD
- `updateDisplayName(name)` - Update user's display name
- `markOnboardingDone()` - Set onboarding complete flag

### Security
- Row Level Security (RLS) enabled on all tables except waitlist
- Users can only access their own data via `auth.uid() = id`
- Worker uses service role key for telemetry inserts

## macOS Permissions

Three permissions required: Microphone, Accessibility, Input Monitoring

### Flow
1. `PermissionsProvider` polls on app focus/visibility
2. Missing permissions trigger notification loop with "Double click to review"
3. Permissions panel auto-opens until all grants are obtained
4. Input Monitoring button disabled until Accessibility is granted (dependency)

### Key Files
- `src/hooks/usePermissions.ts` - Permission polling and detection
- `src/state/permissionsContext.tsx` - React context for permission state
- `src/components/PermissionsPanel.tsx` - Permission grant UI

## Instrumentation & Monitoring

Sentry instrumentation across both app and worker:

### App (Electron)
- SDK: `@sentry/electron` in main and renderer
- Init: `src/renderer.tsx`, `src/main.ts`
- Captures errors, breadcrumbs with PII filtering

### Worker (Cloudflare)
- SDK: `@sentry/cloudflare` with Logs integration
- Traces per dictation with HTTP spans for STT/LLM
- Session summary logs with `session.trace_id` correlation

### Analytics (dictation_logs)
- Worker writes to Supabase after each transcription
- Metrics: timing (dictation_ms, e2e_ms, stt_ms, llm_ms), word_count, provider info
- Privacy: No transcription text stored, only metadata

## Publishing & Updates

App uses Electron's auto-updater with Cloudflare R2 hosting:
- Base URL: https://download.spoke.so
- Publish with `npm run publish` (requires .env with R2 credentials)
- Update flow managed via `RELEASES.json` manifest