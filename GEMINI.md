# Gemini Context: Sonic Flow

This document provides a comprehensive overview of the Sonic Flow project, an AI-powered dictation application for macOS. It is intended to be used as a instructional context for Gemini.

## Project Overview

Sonic Flow is a lightweight, high-performance dictation application built with Electron, TypeScript, and React. It provides fast, real-time speech-to-text transcription through a WebSocket-based audio streaming architecture. The application is designed with a focus on elegant design, low latency, and seamless integration with the macOS ecosystem.

### Core Technologies

*   **Frontend:** Electron, React, TypeScript, Vite, Tailwind CSS
*   **Backend (Transcription):** Cloudflare Workers, Hono, Groq API (for Whisper model)
*   **Native Integration:** C-based helper for macOS Accessibility APIs
*   **Authentication:** Supabase (Google OAuth, Magic Links)
*   **Build & Packaging:** Electron Forge
*   **Testing:** Vitest

### Architecture

The application follows a multi-process architecture:

1.  **Electron Main Process (`src/main.ts`):** Manages the application lifecycle, windowing, native integration (tray menu, protocol handlers), and communication with the renderer process.
2.  **React Renderer Process (`src/renderer.tsx`):** Implements the user interface, including the main "pill" component, settings panel, and onboarding flow. It communicates with the main process via the preload script.
3.  **Cloudflare Worker (`worker/src/index.ts`):** A serverless backend that handles WebSocket connections for real-time audio streaming, interfaces with the Groq API for speech-to-text transcription, and can perform LLM-based post-processing.
4.  **Native Helper (`native/sonic-helper.c`):** A C-based command-line utility that provides low-level access to macOS Accessibility and Input Monitoring APIs. It is used for seamless text insertion at the user's cursor position and for detecting global key presses (e.g., the "Option" key for canceling transcription).

## Building and Running

The project is managed with npm and uses a comprehensive set of scripts defined in `package.json`.

### Development

To run the application in a development environment:

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **Start the Cloudflare Worker locally:**
    ```bash
    npm run dev:ws
    ```
3.  **Start the Electron application:**
    *   **With a local WebSocket server:**
        ```bash
        npm run dev:local
        ```
    *   **With the production WebSocket server:**
        ```bash
        npm run dev:prod
        ```

### Building for Production

To build and package the application for distribution:

1.  **Create a distributable package (e.g., an `.app` bundle):**
    ```bash
    npm run package
    ```
2.  **Create a disk image (`.dmg`):**
    ```bash
    npm run make
    ```

### Testing

The project uses Vitest for unit and integration testing.

*   **Run all tests:**
    ```bash
    npm run test
    ```
*   **Run tests in watch mode:**
    ```bash
    npm run test:watch
    ```
*   **Generate a coverage report:**
    ```bash
    npm run coverage
    ```

## Development Conventions

*   **Coding Style:** The project uses ESLint and Prettier for code linting and formatting. The configuration files (`.eslintrc.json`, `.prettierrc`) enforce a consistent style.
*   **TypeScript:** The codebase is written in TypeScript, with strict type checking enabled.
*   **React:** The frontend is built with React functional components and hooks.
*   **State Management:** The main UI component (`src/components/App.tsx`) uses a reducer (`pillReducer`) to manage its state as a state machine.
*   **Styling:** Tailwind CSS is used for utility-first styling, with a custom design system defined in `tailwind.config.js` and `src/index.css`. The design system is documented in `docs/DESIGN.md`.
*   **Native Integration:** The native helper is written in C and compiled during the `postinstall` step using the `native/build-helper.sh` script.
*   **Documentation:** The `docs/` directory contains detailed documentation on various aspects of the project, including design, authentication, transcription, and testing.
