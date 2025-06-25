# Gemini Project Helper

This document provides a quick overview of the `sonic-flow` project to help Gemini assist with development tasks. It is a combination of the original `GEMINI.md` and the more detailed `CODEMAP.md`.

## Project Overview

`sonic-flow` is a lightweight AI dictation application built with Electron, React, and TypeScript. It uses various AI backends for transcription, including local models via ONNX runtime and remote APIs.

## How it fits together

1.  `App.tsx` and the native `fn-tap` helper send toggle/push-to-talk events which `useTranscription.ts` reacts to.
2.  The hook records audio via an `AudioWorklet` into a `RingBuffer`.
    -   In local mode, `local-worker.ts` processes the buffer directly.
    -   In cloud mode, the main process drains the buffer and forwards it to `groq-transcriber.ts` or `gemini-transcriber.ts`.
3.  Transcripts are inserted into the active application by the main process.
4.  Windows (pill, home, notifications) and the system tray/menu are all controlled from `main.ts`.

## Key Technologies

-   **Framework:** Electron
-   **UI:** React, Tailwind CSS, Framer Motion
-   **Language:** TypeScript
-   **Build Tool:** Vite
-   **Packaging:** Electron Forge
-   **Linting:** ESLint
-   **Formatting:** Prettier
-   **AI/Transcription:**
    -   Hugging Face Transformers.js
    -   ONNX Runtime Web
    -   Web Workers for background processing

## Project Structure

### Root Files

-   `index.html`: HTML entry point loaded by Electron.
-   `package.json`: Dependencies and npm scripts.
-   `forge.config.ts`: Electron Forge build settings.
-   `vite.config.ts`: Shared Vite configuration.
-   `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`: Vite presets for the main process, preload script, and renderer.
-   `tailwind.config.js` / `postcss.config.js`: Tailwind CSS and PostCSS configuration.
-   `tsconfig.json`: TypeScript compiler options.
-   `native/`: Contains a small C helper (`fn-tap.c`) compiled via `build-helper.sh` to `public/assets/fn-tap`. It detects the Fn key for push‑to‑talk.

### `src/` Directory

#### Entry points

-   `main.ts`: Starts the Electron app, creates windows, spawns the `fn-tap` helper, handles IPC, and routes transcription requests.
-   `preload.ts`: Exposes a safe `window.electron` API to the renderer process.
-   `renderer.tsx`: React bootstrap that renders the `<App>` and `<HomePage>` components.
-   `index.css`: Global styles.

#### Components (`src/components/`)

-   `App.tsx`: The main floating pill UI that toggles recording using the `useTranscription` hook.
-   `HomePage.tsx`: The dashboard and settings window.
-   `Pill.tsx`: The visual pill component that responds to hover, listening, and processing states.

#### Hook (`src/hooks/`)

-   `useTranscription.ts`: The central hook. It manages microphone access, spawns an `AudioWorklet` that writes into a `RingBuffer`, and dispatches audio to either a local worker or a main-process transcriber. It's also responsible for inserting the returned text at the cursor.

#### Workers (`src/workers/`)

-   `local-worker.ts`: Runs in a worker thread. Loads an on-device ASR model from Hugging Face and streams partial transcripts back.
-   `groq-transcriber.ts`: A main-process helper that forwards audio to a Cloudflare worker, which then calls the Groq API.
-   `gemini-transcriber.ts`: A similar helper that forwards audio to the Sonic Flow backend to use the Gemini API.

#### Audio Utilities (`src/audio/`)

-   `ring-buffer.ts`: A `SharedArrayBuffer`-backed ring buffer used by the audio worklet and the local worker.

#### Types (`src/types/`)

-   `*.d.ts`: Global type declarations for Electron, Vite, and workers.

### Public Assets (`public/`)

-   `assets/`: Contains icons and the compiled `fn-tap` binary.
-   `audioworklet-processor.js`: The worklet that captures audio from the microphone and writes it to the ring buffer.

## Development Commands

-   **Run the app:** `npm start`
-   **Lint the code:** `npm run lint`
-   **Build the app:** `npm run make`
-   **Package the app:** `npm run package`
-   **Clean build artifacts:** `npm run clean`