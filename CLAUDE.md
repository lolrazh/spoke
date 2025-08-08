# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Sonic Flow** is a lightweight AI dictation app for macOS, built with Electron, React, TypeScript, and Tailwind CSS. It provides a floating pill interface for push-to-talk dictation with real-time transcription and text insertion.

## Key Development Commands

### Essential Scripts
- `npm start` - Start development server (Electron Forge + Vite)
- `npm run package` - Package app for arm64 architecture
- `npm run make` - Create DMG installer for distribution
- `npm run lint` - Run ESLint on TypeScript/TSX files
- `npm run clean` - Clean build output directory

### Development Environment
- `./dev-onboarding.sh` - Enhanced development mode with mock permissions and debug features
- `./test-onboarding.sh` - Test onboarding flow scenarios  
- `./test-permission-scenarios.sh` - Test different permission states

### Native Components
- `./native/build-helper.sh` - Build native helper binary (runs automatically on postinstall)
- Native helper handles system permissions (accessibility, input monitoring) and hotkey detection

## Architecture Overview

### Core Architecture
- **Main Process** (`src/main.ts`): Electron main process handling window management, system permissions, IPC, and native helper coordination
- **Renderer Process** (`src/renderer.tsx`): React app entry point
- **Preload Script** (`src/preload.ts`): Secure bridge between main and renderer processes

### Key Components
- **App Component** (`src/components/App.tsx`): Main application logic with pill state machine
- **Pill Component** (`src/components/Pill.tsx`): Floating UI element for dictation interface
- **Onboarding Component** (`src/components/Onboarding.tsx`): Permission setup and user onboarding flow
- **useTranscription Hook** (`src/hooks/useTranscription.ts`): Core transcription logic and audio processing

### Window System
- **Main Window**: Floating pill interface (transparent, always-on-top, click-through)
- **Onboarding Window**: Permission setup and configuration (vibrancy effects on macOS)
- **Position Constants**: `src/constants/window.ts` and `src/constants/onboarding.ts`

### State Management
- Pill state machine with states: IDLE, LISTENING, PROCESSING, NOTIFICATION, HOVER_PREVIEW, EXPANDED
- Managed through React useReducer in App.tsx
- IPC communication between main and renderer processes

### Design System
- **CSS Variables**: Defined in `src/index.css` for colors, surfaces, and motion tokens
- **Tailwind Config**: `tailwind.config.js` with custom design tokens and glassmorphic shadows
- **Component Library**: UI components in `src/components/ui/` (button, select, switch)
- **Design Tokens**: Configuration files in `src/config/` for consistent styling

### Native Integration
- **Helper Binary**: `native/sonic-helper.c` compiled to macOS app bundle
- **Permissions**: Handles microphone, accessibility, and input monitoring permissions
- **Hotkey Detection**: Function key press/release detection for push-to-talk
- **Text Insertion**: Direct text insertion at cursor position via accessibility APIs

### Audio Processing
- Web Audio API with AudioWorklet for real-time processing
- Custom audio processor: `public/audioworklet-processor.js`
- Microphone device management and selection
- Audio feedback with WAV file playback

### Build System
- **Vite**: Modern build tool with multiple entry points (main, preload, renderer)
- **Electron Forge**: Application packaging and distribution
- **TypeScript**: Full type safety with path aliases (`@/*` → `src/*`)
- **Code Signing**: Configured for macOS development certificates

## Important Patterns

### IPC Communication
- Use strongly typed IPC handlers defined in `src/types/electron.d.ts`
- All IPC calls return promises with proper error handling
- Context bridge ensures secure communication between processes

### Permission Management
- Always check permissions before requesting
- Use native helper for consistent cross-environment permission checks
- Handle permission denial gracefully with user guidance

### State Synchronization
- Pill state drives window visibility and click-through behavior
- Microphone selection synced between renderer and main process via IPC
- Notification system broadcasts messages to all windows

### Error Handling
- Graceful degradation when native components unavailable
- User-friendly error messages via notification system
- Comprehensive logging for debugging

## Testing and Development

### Development Flags
- `SF_DEV_ONBOARDING=1` - Enhanced onboarding features
- `SF_DEV_SKIP_PERMISSIONS=true` - Skip system permission checks
- `SF_DEV_MOCK_PERMS=true` - Use mock permission states
- `SF_DESIGN_MODE=1` - Enable design system debug features

### Mock Permissions
- Configurable via environment variables for UI development
- `SF_MOCK_MIC_STATE`, `SF_MOCK_AX_STATE`, `SF_MOCK_IM_STATE`
- Service in `src/services/mockPermissions.ts`

### Debugging
- DevTools automatically open in development mode
- Debug pill with `?debugPill` URL parameter
- Comprehensive trace logging in App component

## File Structure Highlights

### Core Logic
- `src/main.ts` - Main process with window management and system integration
- `src/components/App.tsx` - Application logic and pill state machine
- `src/hooks/useTranscription.ts` - Audio processing and transcription

### Configuration
- `forge.config.ts` - Electron Forge build configuration
- `vite.*.config.ts` - Separate Vite configs for main, preload, and renderer
- `src/config/` - Design tokens and application configuration

### UI and Styling  
- `src/index.css` - Global styles with CSS custom properties
- `src/components/ui/` - Reusable UI component library
- `DESIGN.md` - Comprehensive design system documentation

### Development Tools
- `dev-onboarding.sh` - Development environment setup
- `native/build-helper.sh` - Native component build script
- `test-*.sh` - Testing scripts for different scenarios