# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sonic Flow is a lightweight AI dictation application for macOS built with Electron and TypeScript. The app provides real-time speech-to-text transcription using WebSocket-based audio streaming and a native helper for system integration.

## Key Commands

### Development
- `npm run dev` - Start development with devtools enabled
- `npm run dev:local` - Development with local WebSocket server
- `npm run dev:prod` - Development with production WebSocket server
- `npm run dev:ws` - Start the Cloudflare Worker locally

### Building and Packaging
- `npm run package` - Package the app for current architecture (arm64)
- `npm run make` - Create distributable packages
- `npm run stage:local:package` - Package for staging with local backend
- `npm run stage:prod:package` - Package for staging with production backend

### Code Quality
- `npm run lint` - Run ESLint on TypeScript files
- `npm run clean` - Remove build artifacts
- `npm run postinstall` - Build native helper (runs automatically)

### Testing
- `npm run test` - Run tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run coverage` - Run tests with coverage report

### Utilities
- `npm run kill:port:8787` - Kill processes on port 8787 (dev server)

## Architecture Overview

### Multi-Process Structure
The application follows Electron's multi-process architecture:

- **Main Process** (`src/main.ts`) - Handles system integration, window management, native helper coordination, authentication flows, and microphone device management
- **Renderer Process** (`src/renderer.tsx`, `src/components/App.tsx`) - React-based UI with pill state management, transcription handling, and user interactions
- **Preload Script** (`src/preload.ts`) - Secure IPC bridge exposing controlled APIs to the renderer
- **Native Helper** (`native/sonic-helper.c`) - C binary for macOS accessibility features and text insertion
- **Cloudflare Worker** (`worker/src/index.ts`) - WebSocket-based transcription service using Groq API

### Key Components

#### Pill State Machine (`src/components/App.tsx`)
The core UI element uses a state machine pattern with states:
- `IDLE` - Default resting state
- `LISTENING` - Actively recording audio
- `PROCESSING` - Transcribing audio on server
- `NOTIFICATION` - Showing user feedback
- `HOVER_PREVIEW` - Mouse hover state
- `EXPANDED` - Settings/configuration mode

#### WebSocket Transcription (`src/hooks/useTranscription.ts`)
Real-time audio streaming with:
- PCM16 audio capture at 16kHz
- 100ms frame buffering
- Binary WebSocket protocol with headers
- Automatic reconnection with circuit breaker (max 10 attempts)
- Production-ready error handling and connection cleanup
- DOS protection with per-IP connection limits (5 max)
- Post-roll capture (~160ms) to prevent end-of-speech clipping

#### Authentication System (`src/lib/supabaseClient.ts`)
Hybrid OAuth flow using:
- Supabase for Google OAuth and magic links
- Custom deep link handling (`sonicflow://` protocol)
- Environment-specific callback URLs
- Local HTTP server for development

#### Native macOS Integration
- System accessibility permissions and input monitoring
- Text insertion at cursor position via native helper
- Microphone device enumeration and selection
- Native vibrancy and window behaviors
- Pre-spawned paste helper daemon for reduced latency (~25ms savings)

### File Structure Patterns

#### Source Organization
```
src/
├── components/        # React components
│   ├── ui/           # Base design system components
│   └── icons/        # Custom icon components
├── config/           # Configuration constants
├── constants/        # App-wide constants
├── hooks/            # Custom React hooks
├── lib/              # Utility libraries
├── types/            # TypeScript type definitions
├── utils/            # Helper functions
├── main.ts           # Electron main process
├── preload.ts        # IPC bridge
└── renderer.tsx      # React app entry
```

#### Native Helper
- `native/sonic-helper.c` - C source for macOS helper
- `native/build-helper.sh` - Build script for native binary
- Built automatically during `npm install`

#### Worker (Cloudflare)
- `worker/src/index.ts` - Hono-based WebSocket server
- Handles audio transcription via Groq API
- Deployed to Cloudflare Workers
- Production-ready with proper connection lifecycle management
- Standardized WebSocket close codes (1000, 1009, 1011)
- Session deduplication and proper cleanup

## Development Patterns

### IPC Communication
All main/renderer communication uses typed IPC channels defined in `src/types/electron.d.ts`. Key patterns:
- `window.electron.*` - Main process APIs
- `window.ptt.*` - Push-to-talk event handling  
- `window.mic.*` - Microphone device management
- `window.auth.*` - Authentication callback handling

### State Management
- **Pill State**: useReducer with state machine pattern
- **Transcription**: Custom hook with WebSocket management
- **Settings**: Electron store with IPC synchronization
- **Auth**: Supabase client with session management

### WebSocket Protocol
Binary frames with 16-byte headers:
```
[4 bytes: sequence] [4 bytes: payload size] [8 bytes: timestamp] [payload data]
```

### Design System
- Glassmorphic UI with CSS custom properties
- Tailwind CSS with extended theme
- Radix UI primitives for accessibility
- Framer Motion for animations

## Important Configuration

### Environment Variables
- `SF_DEVTOOLS=1` - Enable developer tools
- `VITE_TRANSCRIBE_WS_URL` - WebSocket server URL
- `VITE_SENTRY_DSN` - Error reporting
- `SKIP_AUTH=1` - Bypass authentication (dev only)

### Native Permissions Required
- Microphone access for audio capture
- Accessibility permissions for text insertion
- Input monitoring for global hotkeys

### Supabase Configuration
OAuth callback URLs must be configured:
- Development: `http://127.0.0.1:43112/auth/callback`
- Production: `https://auth.sonicflow.app/auth/callback`
- Deep links: `sonicflow://auth/callback`

## Testing and Debugging

### Native Helper Testing
Several test utilities available in project root:
- `./test-ax` - Test accessibility features
- `./debug-focus` - Debug window focus issues
- `./check-editable` - Verify text field detection

### Development Flags
- Add `?debugPill` to URL for pill state debugging
- Use `SF_DEVTOOLS=1` for extended logging
- Enable Sentry in staging with appropriate environment variables

### Common Issues
- **Port conflicts**: Use `npm run kill:port:8787` to clear dev server
- **Native helper build**: Ensure Xcode command line tools installed
- **Permissions**: Check System Preferences for accessibility/input monitoring
- **WebSocket connection**: Verify URL configuration for target environment
- **Startup ghost box**: Fixed via renderer-ready handshake and early transparency guard
- **End-of-speech clipping**: Mitigated with POST_ROLL_MS capture before connection teardown

## Agent Session Logging

This project uses structured agent session logging in `agent-logs/` directory. When making significant changes, create session logs following the template in `agent-logs/README.md` with:
- Descriptive session title and status
- User intention and what was accomplished  
- Technical implementation details and files modified
- Bugs encountered and their solutions
- Key learnings and architecture decisions
- Context for future development sessions

## Code Quality Standards

- **TypeScript**: Strict mode enabled, prefer explicit types
- **ESLint**: Standard configuration, must pass before commits
- **Accessibility**: WCAG 2.1 AA compliance required
- **Performance**: Hardware-accelerated animations, reduced motion support
- **Security**: No secrets in code, proper input validation
- **Native Integration**: Follow macOS HIG guidelines

## Deployment

### Production Builds
Use staging variants for testing:
- `npm run stage:local:make` - Full staging build with local WebSocket server
- `npm run stage:prod:make` - Full production-like build
- Code signing configured for internal testing
- DMG packaging with custom background

### Worker Deployment
- `cd worker && npx wrangler deploy` - Deploy to Cloudflare
- Requires GROQ_API_KEY environment variable
- WebSocket endpoint becomes available at configured URL