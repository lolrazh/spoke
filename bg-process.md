## Troubleshooting Report: Sonic Flow Lingering Process Issue

**Subject:** Investigation into Electron application processes not terminating correctly upon exit.

**Date:** April 20, 2025

**1. Problem Description:**

The Sonic Flow application, built with Electron (Forge) and Vite + React + TypeScript, fails to shut down completely when exited via the context menu (accessible from the tray icon and the main "pill" UI).

*   **Observed Behavior:**
    *   When the application is running normally, Task Manager typically shows 6 "Sonic Flow" processes.
    *   Upon selecting "Exit" from the context menu, the application windows close, but Task Manager continues to show 5 "Sonic Flow" processes running indefinitely, often marked as background processes.
    *   Starting and stopping the audio recording feature appears to increase the process count while running, but the final count after attempting to exit remains 5.

**2. Initial Analysis:**

*   **Process Identification:** An Electron application normally consists of:
    *   1 Main Process (handles Node.js APIs, window creation, app lifecycle).
    *   1 Renderer Process per `BrowserWindow` (handles the UI and web content for that window). In this app: `mainWindow` (pill), `contextMenuWindow`, `captureWindow`.
    *   Electron Helper Processes (e.g., GPU process, network service).
    *   The initial count of 6 processes aligns with this structure (1 Main + 3 Renderers + ~2 Helpers).
*   **Shutdown Flow Analysis:** The exit process is initiated by the 'Exit' button in the `contextMenuWindow` sending an IPC message (`menu-exit`) to the Main Process. The Main Process handler for `menu-exit` calls `app.quit()`. The intended cleanup (destroying windows, tray, unregistering shortcuts, etc.) was designed to occur within the `app.on('will-quit', ...)` event handler.

**3. Troubleshooting Steps & Findings:**

*   **Attempt 1: Refactoring Shutdown Logic**
    *   **Hypothesis:** Premature calls to `app.quit()` or manual resource destruction in handlers other than `will-quit` were preventing complete cleanup.
    *   **Action:**
        *   Removed `app.quit()` call from `mainWindow.on('close', ...)` handler.
        *   Removed manual `tray.destroy()` and `contextMenuWindow.destroy()` calls from the `menu-exit` IPC handler.
        *   Centralized all cleanup logic (destroying all windows including `mainWindow`, destroying tray, unregistering shortcuts, closing log stream, cleaning temp files) within the `app.on('will-quit', ...)` handler.
    *   **Result:** Problem persisted. App started with 6 processes, exited with 5 remaining.
    *   **Conclusion:** The issue wasn't caused by the *location* of the cleanup logic but potentially by the cleanup logic itself or the execution of the `will-quit` event.

*   **Attempt 2: Isolate Potential Culprits (Simplification Test)**
    *   **Hypothesis:** The lingering process could be related to the less essential `captureWindow` (for hotkeys) or the complex recording/transcription logic (`MediaRecorder`, Groq API calls, audio streams). The initial test was flawed as it removed the context menu needed for exit, this was corrected.
    *   **Action:**
        *   Commented out the creation of `captureWindow` in `main.ts`.
        *   Commented out the core functionality within `handleStartDictation` and `handleStopDictation` in `App.tsx` (specifically calls to `startRecording`, `stopRecording`, `transcribeAudio`).
        *   Repackaged and tested the simplified application.
    *   **Result:** Problem persisted. Simplified app started with (presumably fewer, e.g., 5) processes, but still left processes remaining after exit (count dropped by only 1). User reported counts of 6 -> 5, indicating the base process count might vary slightly or include persistent helpers.
    *   **Conclusion:** The lingering process is fundamental to the core app structure (Main process, `mainWindow`, `contextMenuWindow`, Tray, Electron helpers) and *not* caused by the hotkey window or recording features.

*   **Attempt 3: Deep Dive into `will-quit` Event Execution**
    *   **Hypothesis:** The `app.on('will-quit', ...)` handler, containing the crucial cleanup logic, might not be executing correctly or at all.
    *   **Action 1:** Added detailed, timestamped logging statements before and after every single operation inside the `will-quit` handler.
    *   **Result 1:** When exiting the app, **none** of the logs from within the `will-quit` handler appeared in the `sonic-flow.log` file.
    *   **Action 2:** Moved the very first log statement (`Handler invoked.`) outside the `try...catch` block within the `will-quit` handler to test if the handler was even being entered.
    *   **Result 2:** The initial `Handler invoked.` log **still did not appear** in the log file upon exit.
    *   **Conclusion 1:** The `app.on('will-quit', ...)` callback function is **not being executed** when `app.quit()` is called via the context menu exit path.
    *   **Hypothesis 2:** The presence of a redundant `app.on('quit', ...)` handler might interfere.
    *   **Action 3:** Commented out the entire `app.on('quit', ...)` handler block. Added logging immediately before and after the `app.quit()` call in the `menu-exit` handler.
    *   **Result 3:** Logs confirmed that `app.quit()` was being called successfully in the `menu-exit` handler, but the `will-quit` logs **still did not appear**.
    *   **Conclusion 2:** The `app.on('quit', ...)` handler was not the cause. The `will-quit` event is fundamentally not firing or being blocked.

**4. Current Status & Conclusion:**

The code has been reverted to the state after the initial refactoring (Attempt 1). The core issue remains unresolved: the application leaves 5 processes running after exit.

Diagnostic steps have confirmed that the `app.on('will-quit', ...)` event handler, which is critical for performing cleanup before the application terminates, is **not executing** when the application is quit via the context menu's `app.quit()` call. The reason for `will-quit` not firing is unknown but prevents the necessary destruction of windows, the tray, and other resources, leading to the main process and associated helper/renderer processes lingering.

**5. Potential Next Steps (Suggestions):**

*   Investigate potential interference with the `will-quit` event from third-party Node modules used in the main process.
*   Experiment with different methods of triggering `app.quit()` (e.g., programmatically after a delay, or via a standard Electron menu bar if added temporarily).
*   Check for known Electron bugs related to `will-quit` on the specific Electron version being used.
*   Simplify the main process further by removing potentially problematic imports or initializations one by one to see if `will-quit` starts firing.
*   Consider adding more robust error handling around the `app.quit()` call itself, although it appears to execute.