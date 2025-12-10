# Spoke README

A lightweight AI dictation application for macOS built with Electron and TypeScript. Spoke provides fast speech-to-text transcription using WebSocket-based audio streaming (no text streaming) and a native helper for seamless system integration.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Quick Start](#quick-start)
4. [Development](#development)
5. [Technology Stack](#technology-stack)
6. [Key Features](#key-features)
7. [Project Structure](#project-structure)
8. [Configuration](#configuration)
9. [Testing](#testing)
10. [Deployment](#deployment)
11. [Documentation](#documentation)
12. [Contributing](#contributing)

## Overview

Spoke is designed as a better alternative to existing dictation tools like Wispr Flow, with a focus on elegant design, performance, and native macOS integration. The app features a minimal glassmorphic UI that stays out of your way while providing powerful real-time transcription capabilities.

### Key Advantages

- **Better Design**: Glassmorphic UI with native macOS vibrancy and subtle animations
- **Low Latency**: Optimized WebSocket protocol with ~2-3s end-to-end transcription
- **Native Integration**: Seamless text insertion using macOS Accessibility APIs
- **Production Ready**: Comprehensive error handling, monitoring, and performance metrics
- **Modern Stack**: Built with latest Electron, Vite, TypeScript, and React

## Architecture

Spoke follows a multi-process architecture optimized for real-time audio processing:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Electron      │    │   Cloudflare    │    │   Native        │
│   Main App      │───▶│   Worker        │───▶│   Helper        │
│   (TypeScript)  │    │   (WebSockets)  │    │   (C Binary)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
   React Renderer          Groq/Fireworks         macOS Accessibility
   Pill State UI           Speech-to-Text              Text Insertion
```

### Core Components

1. **Electron Main Process** (`src/main.ts`) - Window management, native integration, authentication
2. **React Renderer** (`src/components/App.tsx`) - Pill UI with state machine pattern
3. **Cloudflare Worker** (`worker/src/index.ts`) - Real-time transcription service
4. **Native Helper** (`native/sonic-helper.c`) - macOS accessibility and text insertion
5. **Audio Pipeline** (`src/hooks/useTranscription.ts`) - Real-time audio processing

## Quick Start

### Prerequisites

- **macOS 11+** (Big Sur or later)
- **Node.js 18+** with npm
- **Xcode Command Line Tools** (for native helper compilation)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/spoke.git
cd spoke

# Install dependencies
npm install

# Start development server
npm run dev:ws
npm run dev:local 
```

### Production Build

```bash
# Build and package for current architecture (arm64)
npm run package

# Create distributable DMG
npm run make
```

## Development

### Development Commands

```bash
# Development with devtools enabled
npm run dev

# Development with local WebSocket server
npm run dev:local

# Development with production WebSocket server
npm run dev:prod

# Start Cloudflare Worker locally
npm run dev:ws
```

### Code Quality

```bash
# Lint TypeScript files
npm run lint

# Run tests
npm run test

# Run tests with coverage
npm run coverage

# Watch mode for tests
npm run test:watch
```

### Environment Variables

```bash
# Development
SF_DEVTOOLS=1                           # Enable dev console
VITE_TRANSCRIBE_WS_URL=ws://127.0.0.1:8787/ws  # WebSocket endpoint

# Production
VITE_SENTRY_DSN=your_sentry_dsn         # Error reporting
VITE_SENTRY_ENVIRONMENT=staging         # Environment tag

# Worker
GROQ_API_KEY=your_groq_key             # Required for transcription
```

## Technology Stack

### Frontend Stack

- **Electron 35** - Cross-platform desktop app framework
- **React 18** - UI library with hooks and state management
- **TypeScript 5** - Type-safe development
- **Vite** - Fast build tool and dev server
- **Tailwind CSS** - Utility-first styling with custom design tokens

### Backend Stack

- **Cloudflare Workers** - Edge computing for WebSocket handling
- **Hono** - Fast web framework for Workers
- **Groq API** - High-performance speech-to-text (Whisper)
- **Supabase** - Authentication and user management

### Development Tools

- **Electron Forge** - Build, package, and distribute
- **Vitest** - Fast unit testing with coverage
- **ESLint** - Code linting with TypeScript support
- **Prettier** - Code formatting
- **Sentry** - Error tracking and performance monitoring

### Native Integration

- **C Binary** - macOS Accessibility APIs for text insertion
- **Protocol Registration** - Deep link handling for auth callbacks
- **System Tray** - Native menu integration
- **Vibrancy Effects** - Native macOS visual effects

## Key Features

### Real-Time Transcription

- **WebSocket Protocol**: Binary audio streaming with 16-byte headers
- **Audio Processing**: 16kHz PCM16 with Web Audio API worklets
- **Groq Integration**: Whisper-large-v3 model for high accuracy
- **Low Latency**: ~2-3 second end-to-end transcription time

### Pill State Machine

The core UI uses a sophisticated state machine pattern:

```typescript
type PillState = "IDLE" | "LISTENING" | "PROCESSING" | "NOTIFICATION" | "HOVER_PREVIEW" | "EXPANDED"
```

- **IDLE**: Resting state, ready for input
- **LISTENING**: Actively recording audio with visual feedback
- **PROCESSING**: Server-side transcription in progress
- **NOTIFICATION**: Displaying user feedback messages
- **HOVER_PREVIEW**: Mouse hover interactions
- **EXPANDED**: Settings and configuration mode

### Authentication System

- **Hybrid OAuth Flow**: Supabase + custom deep link handling
- **Environment Adaptive**: HTTP callback (dev) vs hosted page (prod)
- **Google OAuth**: Primary authentication method
- **Magic Links**: Email-based authentication fallback

### Native macOS Integration

- **Text Insertion**: Uses Accessibility APIs to insert at cursor
- **System Permissions**: Microphone and accessibility permission handling
- **Tray Integration**: Native menu bar presence
- **Protocol Handler**: `spoke://` deep link support
- **Window Management**: Native vibrancy and transparency effects

## Project Structure

```
spoke-app/
├── src/                          # Main application source
│   ├── components/               # React components
│   │   ├── ui/                  # Base design system components
│   │   ├── App.tsx              # Main app with pill state machine
│   │   └── Onboarding.tsx       # Authentication flow
│   ├── hooks/                   # Custom React hooks
│   │   └── useTranscription.ts  # Audio processing and WebSocket
│   ├── config/                  # Configuration constants
│   ├── utils/                   # Helper utilities
│   ├── types/                   # TypeScript definitions
│   ├── main.ts                  # Electron main process
│   ├── preload.ts              # IPC bridge
│   └── renderer.tsx            # React app entry
├── worker/                       # Cloudflare Worker
│   ├── src/
│   │   ├── handlers/ws.ts       # WebSocket connection handling
│   │   ├── audio/codec.ts       # PCM processing and WAV wrapping
│   │   ├── services/stt/        # Speech-to-text providers
│   │   │   ├── index.ts         # Provider dispatcher (Groq / Fireworks)
│   │   │   └── providers/…      # Provider-specific clients
│   │   └── index.ts             # Worker entry point
│   └── wrangler.jsonc           # Worker configuration
├── native/                       # Native helper binary
│   ├── spoke-helper.c           # C source for text insertion
│   └── build-helper.sh          # Build script
├── docs/                         # Comprehensive documentation
│   ├── DESIGN.md               # Design system and UI patterns
│   ├── AUTH.md                 # Authentication flow details
│   ├── TRANSCRIPTION.md        # Audio pipeline documentation
│   ├── TESTING.md              # Testing strategies
│   └── INSTRUMENTATION.md      # Monitoring and metrics
├── public/                       # Static assets
│   ├── assets/                  # Icons, sounds, DMG backgrounds
│   ├── fonts/                   # Custom fonts (Lexend, Instrument Serif)
│   └── worklets/                # Web Audio worklets
├── agent-logs/                   # Development session logs
└── CLAUDE.md                     # AI assistant instructions
```

## Configuration

### Build Configuration

The app uses Electron Forge with Vite for building:

- **Packaging**: DMG creation with custom background and icon
- **Code Signing**: Configured for internal testing
- **Fuses**: Security-hardened Electron configuration
- **Bundle ID**: `com.spoke.app`

### Design System

Spoke uses a comprehensive glassmorphic design system:

- **CSS Variables**: Centralized design tokens
- **Tailwind Integration**: Extended theme with custom utilities
- **Typography**: Lexend Deca (body) + Instrument Serif (headings)
- **Glass Effects**: Multi-layer transparency with backdrop blur
- **Motion Design**: Spring physics with reduced motion support

### WebSocket Protocol

Binary protocol optimized for real-time audio:

```
Header: [4B sequence][4B payload_size][8B timestamp]
Payload: PCM16 audio data (little-endian)
```

## Testing

### Test Architecture

- **Unit Tests**: Component and utility testing with Vitest
- **Integration Tests**: End-to-end audio pipeline testing
- **Native Testing**: Helper binary functionality validation
- **Performance Tests**: Latency and throughput benchmarking

### Running Tests

```bash
# Run all tests
npm run test

# Watch mode for development
npm run test:watch

# Coverage report
npm run coverage

# Specific test categories
npm run test -- --grep "transcription"
npm run test -- --grep "authentication"
```

### Test Utilities

The project includes several native testing utilities:

```bash
# Test accessibility features
./test-ax

# Debug focus detection
./debug-focus  

# Verify text field recognition
./check-editable
```

## Publishing (Cloudflare R2)

- Base URL: `https://download.spoke.so`
- Layout produced by Forge ZIP maker:
  - `darwin/<arch>/RELEASES.json`
  - `darwin/<arch>/Spoke-<version>-mac.zip`

### 1) Configure environment

Copy `.env.example` to `.env` and fill in values:

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_BUCKET=releases
R2_REGION=auto
```

Notes:
- R2 does not support S3 ACLs; make the bucket or the public route public in R2 settings or via a bucket policy.
- The S3 publisher uses your R2 endpoint with path-style addressing.

### 2) Build artifacts

```
npm run make    # arm64 by default
```

Artifacts:
- `out/make/zip/darwin/arm64/RELEASES.json`
- `out/make/zip/darwin/arm64/Spoke-<version>-mac.zip`

### 3) Publish to R2 (automated)

```
npm run publish
```

This uploads ZIP + RELEASES.json to `darwin/<arch>/...` in your bucket.

Verification:
- `curl -I https://download.spoke.so/darwin/arm64/RELEASES.json`
- `curl -I "https://download.spoke.so/darwin/arm64/Spoke%20-<version>-mac.zip"`

### 4) Update flow (local test)

1. Install `0.0.1` via DMG.
2. Publish `0.0.2` ZIP + `RELEASES.json` (overwrite manifest) to the same path.
3. Launch the app; it will update and relaunch to `0.0.2`.

Troubleshooting:
- If updates don’t trigger, check app logs and ensure the manifest and ZIP are public, reachable, and not overly cached. You can temporarily use a shorter interval in `src/main.ts`.

See also:
- docs/UPDATE_PIPELINE.md — full “Sonic Flow macOS Auto‑Update Pipeline” guide

## Deployment

### Staging Builds

```bash
# Local staging (with local WebSocket server)
npm run stage:local:package
npm run stage:local:make

# Production-like staging
npm run stage:prod:package
npm run stage:prod:make
```

### Worker Deployment

```bash
# Deploy to Cloudflare Workers
cd worker && npm run deploy

# Requires GROQ_API_KEY environment variable (optional: Sentry DSN)
```

### Environment Management

The app supports multiple environments:

- **Development**: Local servers, dev tools enabled
- **Staging**: Production-like with enhanced logging
- **Production**: Optimized builds with monitoring

## Documentation

Comprehensive documentation is available in the `docs/` folder:

- **[DESIGN.md](docs/DESIGN.md)** - Complete design system documentation
- **[AUTH.md](docs/AUTH.md)** - Authentication flow and OAuth implementation
- **[TRANSCRIPTION.md](docs/TRANSCRIPTION.md)** - Audio pipeline technical details
- **[TESTING.md](docs/TESTING.md)** - Testing strategies and utilities
- **[INSTRUMENTATION.md](docs/INSTRUMENTATION.md)** - Monitoring and observability

### Agent Session Logs

Development sessions are documented in `agent-logs/` with:

- Technical implementation details
- Architecture decisions
- Bug resolutions
- Performance optimizations

## Contributing

### Development Workflow

1. **Setup**: Follow Quick Start installation
2. **Branch**: Create feature branch from `main`
3. **Develop**: Make changes with comprehensive testing
4. **Test**: Run full test suite and manual verification
5. **Document**: Update relevant documentation
6. **PR**: Submit pull request with detailed description

### Code Style

- **TypeScript**: Strict mode with explicit typing
- **React**: Functional components with hooks
- **CSS**: Utility-first with semantic class names
- **Architecture**: Clean separation of concerns

### Performance Guidelines

- **Audio Processing**: Minimize main thread work
- **UI Updates**: Use React.memo and useMemo appropriately
- **Native Integration**: Optimize IPC communication
- **Memory Management**: Proper cleanup of resources

---

## License

Proprietary - All rights reserved by Sandheep Rajkumar

## Contact

**Author**: Sandheep Rajkumar  
**Email**: rajkumar.sandheep@gmail.com

---

*Built with ❤️ for better dictation experiences on macOS*
