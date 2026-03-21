# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development Workflow
- `npm run dev` - Start development with devtools enabled
- `npm run dev:onboarding` - Development with forced onboarding flow

### Testing & Code Quality
- `npm run test` - Run all tests with Vitest
- `npm run test:watch` - Run tests in watch mode for development
- `npm run coverage` - Run tests with coverage report
- `npm run lint` - ESLint TypeScript files

### Building & Packaging
- `npm run package` - Build and package for arm64 architecture
- `npm run make` - Create distributable DMG for arm64
- `npm run clean` - Clean build artifacts

### Staging & Publishing
- `npm run stage:package` - Staging build with Sentry environment tag
- `npm run stage:make` - Staging DMG with Sentry environment tag
- `npm run publish` - Publish to Cloudflare R2 (requires .env configuration)

## Architecture Overview

Spoke is a local-first macOS dictation app built with Electron, React, and TypeScript. No account required — all transcription happens locally or via BYO cloud API keys.

### Core Components
1. **Electron Main Process** (`src/main.ts`) - Window management, native integration, IPC handlers, STT/LLM/OCR services
2. **React Renderer** (`src/components/App.tsx`) - Glassmorphic pill UI with state machine pattern
3. **Enhancement Pipeline** (`src/core/enhancement/`) - Trigger detection, smart routing, dynamic prompts, edit mode
4. **Provider System** (`src/core/transcription/`) - Orchestrator, provider contracts, catalog, preferences
5. **Native Helper** (`native/spoke-helper.c`) - macOS accessibility API integration for text insertion
6. **Local STT Sidecar** (`local-stt/`) - MLX Moonshine model for on-device transcription

### Pill State Machine
The UI follows a state machine pattern with states: `"IDLE" | "LISTENING" | "PROCESSING" | "NOTIFICATION" | "HOVER_PREVIEW" | "EXPANDED"`

### Transcription Pipeline
Full flow: screenshot → OCR → STT → trigger detection → LLM enhancement → paste

1. **Screenshot + OCR** (parallel with recording): Capture screen, extract vocabulary via vision API
2. **STT**: Local (MLX sidecar) or BYO cloud (OpenAI, Groq, Deepgram)
3. **Enhancement**: Detect triggers (spelling, symbols, casing, quotes, disfluency, lists) → if triggers found, call LLM for cleanup; else bypass (90% of cases)
4. **Paste**: Insert text via native helper

Key files:
- `src/hooks/useTranscription.ts` - Recording lifecycle and flow orchestration
- `src/main/providerStore.ts` - API key storage, STT transcription functions
- `src/main/enhanceService.ts` - Enhancement orchestrator (triggers → route → LLM)
- `src/main/llmService.ts` - Chat completions for OpenAI/Groq
- `src/main/ocrService.ts` - Vision API vocabulary extraction
- `src/core/enhancement/triggers.ts` - Regex-based trigger detection
- `src/core/enhancement/prompts.ts` - Dynamic LLM prompt builder

### STT Providers (4 total)
- **Local Moonshine** - On-device via MLX sidecar (no API key needed)
- **OpenAI Direct** - BYO API key, uses `gpt-4o-transcribe`
- **Groq** - BYO API key, uses `whisper-large-v3-turbo`
- **Deepgram** - BYO API key, uses Nova-2

### LLM Enhancement
Enhancement reuses the same API key as the STT provider (if it supports chat completions — OpenAI and Groq do). Deepgram and local STT users get raw output unless they also configure an OpenAI/Groq key.

## Key Directories

- `src/components/` - React components (App.tsx contains main pill state machine)
- `src/hooks/` - Custom React hooks (useTranscription, useProviderSelection, useMicVisualizer, etc.)
- `src/core/transcription/` - Provider contracts, catalog, orchestrator, preferences
- `src/core/enhancement/` - Trigger detection, smart routing, dynamic prompts, edit mode
- `src/main/` - Extracted main process modules (providerStore, sidecarEngine, modelManager, llmService, ocrService, etc.)
- `src/state/` - Pill state machine, transcription history
- `src/utils/` - Utility functions (logger, audioRecorder, screenshot)
- `native/` - C binary for macOS accessibility integration
- `local-stt/` - Python MLX sidecar for local transcription
- `docs/` - Documentation:
  - `DESIGN.md` - UI/UX design specifications
  - `PERMISSIONS.md` - macOS permissions architecture
  - `LOCAL_STT.md` - Local MLX STT setup
  - `UPDATE_PIPELINE.md` - Auto-update process
  - `OPEN_SOURCE_REFACTOR.md` - Refactor plan and status

## Environment Variables

### Development
- `SF_DEVTOOLS=1` - Enable development console
- `FORCE_ONBOARDING=1` - Force onboarding flow
- `SKIP_ONBOARDING=1` - Skip onboarding for testing

### Production
- `VITE_SENTRY_DSN` - Error reporting DSN
- `VITE_SENTRY_ENVIRONMENT` - Environment tag (staging/production)

## Testing Strategy

- **Unit Tests**: Component and utility testing with Vitest and happy-dom
- **Enhancement Tests**: Trigger detection, smart routing, prompt generation (ported from worker)
- **Native Testing**: Helper binary functionality validation
- Test files follow `*.test.ts` or `*.test.tsx` naming convention
- Test setup in `src/test/setup.ts` with mocked MediaRecorder, audio utilities, and IPC bridges

## Native Development

The app includes a native C helper for text insertion via macOS Accessibility APIs:
- Build script: `native/build-helper.sh` (runs automatically on npm install)
- Requires Xcode Command Line Tools for compilation
- Test utilities: `./test-ax`, `./debug-focus`, `./check-editable`

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

### App (Electron)
- SDK: `@sentry/electron` in main and renderer
- Init: `src/renderer.tsx`, `src/main.ts`
- Captures errors, breadcrumbs with PII filtering

## Publishing & Updates

App uses Electron's auto-updater with Cloudflare R2 hosting:
- Base URL: https://download.spoke.so
- Publish with `npm run publish` (requires .env with R2 credentials)
- Update flow managed via `RELEASES.json` manifest
