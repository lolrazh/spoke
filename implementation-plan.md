
# Implementation Plan: Local Whisper Transcription Migration

**Goal:** Replace the cloud-based Groq API transcription with a fully local Whisper model (`whisper-tiny`) running in the renderer process using Transformers.js, Web Workers, and WebGPU.

**Core Principle:** Shift transcription logic from the Electron main process to the renderer process, leveraging Web Workers for non-blocking inference.

---

## Phase 1: Setup & Worker Implementation

1.  **Install Dependencies:**
    *   Ensure `@xenova/transformers` is installed: `npm install @xenova/transformers` (or yarn equivalent).
2.  **Configure Web Worker (`src/stt/whisper-worker.js`):**
    *   Import `pipeline` from `@xenova/transformers`.
    *   Implement message listener (`self.onmessage`) to handle commands from the main renderer thread.
    *   **Model Initialization:**
        *   Add logic to load the `Xenova/whisper-tiny` model upon receiving an `init` message.
        *   Use the `pipeline('automatic-speech-recognition', ...)` function.
        *   Specify `model: 'Xenova/whisper-tiny'`.
        *   Enable `quantized: true` (usually default/recommended for Transformers.js).
        *   Pass `device: 'webgpu'` if WebGPU is available/desired, otherwise let Transformers.js handle fallback (WASM).
        *   Implement progress callback (`progress_callback`) during model loading and post `loading-progress` messages back to the main thread.
        *   Store the initialized pipeline instance in a variable accessible within the worker scope.
        *   Post `init-complete` message on success or `init-error` on failure.
    *   **Transcription Logic:**
        *   Add logic to handle a `transcribe` message containing audio data (e.g., as an `ArrayBuffer` or `Float32Array`).
        *   Ensure the audio data is in the format expected by the Whisper pipeline (usually Float32Array, potentially requiring conversion/resampling if `useWhisperRecorder` provides something else). *Self-correction: Check `useWhisperRecognition` and `useWhisperRecorder` interaction*.
        *   Call the loaded pipeline instance with the audio data.
        *   Specify `language: 'english'` and `task: 'transcribe'`.
        *   Post `transcription-result` message with the transcribed text on success.
        *   Post `transcription-error` message on failure.

## Phase 2: Renderer Hook Integration

1.  **Review/Refine Recognition Hook (`src/stt/useWhisperRecognition.ts`):**
    *   Ensure it correctly creates and manages the `whisper-worker.js` instance.
    *   Implement logic to send the `init` message to the worker upon hook initialization or a specific trigger.
    *   Handle `loading-progress`, `init-complete`, `init-error`, `transcription-result`, and `transcription-error` messages from the worker.
    *   Maintain internal state reflecting the worker/model status (e.g., `isModelLoading`, `loadingProgress`, `isReady`, `isTranscribing`, `error`).
    *   Expose a function (e.g., `transcribeAudio(audioData)`) that sends the `transcribe` message to the worker.
    *   Expose the transcription result (`transcriptionText`) and relevant state variables.
2.  **Review/Refine Recorder Hook (`src/stt/useWhisperRecorder.ts`):**
    *   Verify it handles microphone permissions, start/stop recording.
    *   Confirm the format of the audio data it provides upon stopping (e.g., `Blob`, `ArrayBuffer`, `Float32Array`). Ensure this format is compatible with what the `whisper-worker.js` expects or add conversion logic in `useWhisperRecognition` or `App.tsx` before passing it to the worker.
    *   Expose state like `isRecording`.
3.  **Integrate Hooks into `src/components/App.tsx`:**
    *   Remove imports related to `src/lib/audio.ts`.
    *   Remove state `mediaRecorderRef`.
    *   Instantiate the hooks: `const recorder = useWhisperRecorder();` and `const recognizer = useWhisperRecognition();`.
    *   **State Mapping:**
        *   Replace `isListening` state management with `recorder.isRecording`.
        *   Replace `isProcessing` state management with a combination of `recognizer.isModelLoading` and `recognizer.isTranscribing`. Consider a new state `isLoadingModel` if distinct UI is needed.
    *   **Event Handling:**
        *   Modify `handleStartDictation`:
            *   Call `recorder.startRecording()`.
            *   Remove IPC call `window.electron.startRecording()`.
        *   Modify `handleStopDictation`:
            *   Call `recorder.stopRecording()` to get the audio data.
            *   Remove IPC call `window.electron.stopRecording()`.
            *   If audio data is valid, call `recognizer.transcribeAudio(audioData)`.
    *   **Result Handling:**
        *   Use `useEffect` to watch for changes in `recognizer.transcriptionText`.
        *   When new text arrives, call `window.electron.insertTextAtCursor(recognizer.transcriptionText)`.
        *   Handle errors exposed by `recorder.error` and `recognizer.error` (e.g., using `window.electron.sendNotification`).
    *   **Cleanup:** Ensure hook cleanup functions are called on unmount.

## Phase 3: UI and Main Process Adjustments

1.  **Update UI (`src/components/Pill.tsx`):**
    *   Adjust props passed from `App.tsx` based on the new state management (e.g., pass `isLoadingModel` if added).
    *   Modify conditional rendering to account for `isLoadingModel` state if necessary (e.g., show a different spinner/indicator).
2.  **Clean Main Process (`src/main.ts`):**
    *   Remove the `transcribe-audio` IPC handler (`ipcMain.handle('transcribe-audio', ...)`).
    *   Remove the `start-recording` IPC handler (`ipcMain.handle('start-recording', ...)`).
    *   Remove the `stop-recording` IPC handler (`ipcMain.handle('stop-recording', ...)`).
    *   Remove the import of `{ transcribeAudio, cleanupTempFiles }` from `./lib/transcription`.
    *   Remove the `recordingData` global variable.
    *   Remove `cleanupTempFiles` call in `app.on('quit')` if it's no longer needed (local STT doesn't use temp files).
3.  **Clean Preload Script (`src/preload.ts`):**
    *   Remove `startRecording`, `stopRecording`, and `transcribeAudio` from the `contextBridge.exposeInMainWorld('electron', ...)` object.

## Phase 4: Cleanup and Testing

1.  **Delete Obsolete Files:**
    *   Delete `src/lib/audio.ts`.
    *   Delete `src/lib/transcription.ts`.
    *   Delete the `sonic-flow` temporary directory creation logic and potentially the directory itself if no longer used (`TEMP_DIR` in `main.ts` or `transcription.ts`).
2.  **Testing:**
    *   **First Launch:** Verify model download progress indicator (if implemented) and successful initialization. Check console for WebGPU/WASM usage.
    *   **Basic Transcription:** Start recording, speak, stop recording. Verify text insertion.
    *   **Hotkey Control:** Test starting and stopping dictation using the global hotkey.
    *   **Error Handling:**
        *   Deny microphone permission and try to record. Verify error notification.
        *   Simulate a worker error (if possible) or test edge cases (e.g., stopping immediately after starting).
    *   **Resource Usage:** Monitor CPU/GPU/Memory usage during model load and transcription (basic check).
    *   **Repeated Use:** Test multiple back-to-back transcriptions.

---
This plan provides a step-by-step guide. We will proceed through these phases, focusing on one part at a time.
