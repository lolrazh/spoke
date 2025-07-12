# The All-In Refactor: A Lean & Mean Implementation Plan

This document provides a comprehensive, step-by-step guide to refactor the Sonic Flow application into a leaner, more performant, and more maintainable system.

---

## 0. The North Star (Definition of Done)

*   **Mental Model:** Electron captures 16 kHz Int16 audio, streams it to a single Cloudflare Worker, the Worker calls Groq, and returns the transcribed text. That's it.
*   **Single Engine:** Groq's `whisper-large-v3-turbo` is the one and only ASR engine.
*   **Single Transport:** Audio is streamed as raw 16 kHz Int16 PCM blocks to our Cloudflare Worker.
*   **No Bloat:** All code, UI, and configuration for local ASR (SAB, RingBuffer) and the Gemini backend are completely removed.
*   **Target Latency:** End-to-paste transcription time for a 60-second clip is consistently under 1.8 seconds on a standard broadband connection.

---

## 1. The Roadmap (Milestones)

1.  **Prune Dead Wood:** Delete all files and dependencies related to the local and Gemini backends. The app must still build after this phase.
2.  **Implement New Audio Pipeline:** Create the new `AudioWorklet` to handle down-sampling and Int16 conversion.
3.  **Rewrite the Cloudflare Worker:** Deploy a new worker that accepts the raw audio stream and forwards it to Groq.
4.  **Refactor `useTranscription.ts`:** Overhaul the core hook to use a single, stream-based mode with a simplified state machine.
5.  **Simplify UI & Config:** Remove all UI toggles and settings related to engine selection.
6.  **Validate & QA:** Rigorously test latency, memory usage, and functionality against the checklist.
7.  **Final Cleanup:** Update documentation and remove any lingering dead code or config.

---

## 2. The Hit List (File-by-File Action Plan)

### 2.1. Files to DELETE

| Path                                        | Why                                                     |
| ------------------------------------------- | ------------------------------------------------------- |
| `src/workers/local-worker.ts`               | Local ASR path is being removed.                        |
| `src/workers/gemini-transcriber.ts`         | Gemini backend is being removed.                        |
| `src/workers/groq-transcriber.ts`           | This logic moves to the new Cloudflare Worker.          |
| `src/workers/vad-worker.ts`                 | VAD was only used by the local ASR.                     |
| `src/workers/wav-encoder.ts`                | We are no longer encoding WAV files on the client.      |
| `src/audio/ring-buffer.ts`                  | The SAB/RingBuffer architecture is no longer needed.    |
| `src/utils/wav.ts`                          | No client-side WAV encoding.                            |
| `public/audioworklet-processor.js`          | Will be replaced with a new, simplified version.        |

### 2.2. Files to CREATE / REPLACE

#### New AudioWorklet (`public/audioworklet-processor.js`)

This processor will live in the `public` folder and be loaded directly. It decimates the audio from 48kHz to 16kHz, converts it to Int16, and posts it in 60ms chunks.

```javascript
// public/audioworklet-processor.js
class CaptureProcessor extends AudioWorkletProcessor {
  // Each 16-bit sample is 2 bytes. 16000 samples/sec * 0.060 sec = 960 samples per chunk.
  pcm16 = new Int16Array(960);
  idx = 0;

  constructor() {
    super();
    console.log("CaptureProcessor: Initialized for 16kHz Int16 streaming.");
  }

  process(inputs, outputs, parameters) {
    // Use the first input and first channel, which is standard for mono mic input.
    const inputChannelData = inputs[0]?.[0];

    // If there's no data, we have nothing to do. Keep the processor alive.
    if (!inputChannelData) {
      return true;
    }

    // Decimate the 48kHz input to 16kHz by taking every 3rd sample.
    for (let i = 0; i < inputChannelData.length; i += 3) {
      // Clamp the sample to the [-1, 1] range to prevent clipping upon conversion.
      const sample = Math.max(-1, Math.min(1, inputChannelData[i]));

      // Convert the Float32 sample to a 16-bit integer.
      this.pcm16[this.idx++] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;

      // When the buffer is full, send it to the main thread.
      if (this.idx === 960) {
        // Post a copy of the buffer. The underlying ArrayBuffer is transferred.
        this.port.postMessage(this.pcm16.buffer.slice(0));
        this.idx = 0; // Reset index for the next chunk.
      }
    }

    // Return true to indicate the processor should not be terminated.
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
```

#### New Cloudflare Worker (`workers/gate.js` or similar)

This worker is the new single entry point. It buffers the raw Int16 audio stream and then forwards it to Groq.

```javascript
// workers/gate.js
export default {
  async fetch(req, env) {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed. Please use POST.', { status: 405 });
    }

    // Read the entire raw Int16 audio stream into a single ArrayBuffer.
    const pcm_s16le = await req.arrayBuffer();

    // Create a FormData object to send to Groq's API.
    const form = new FormData();
    // Groq expects a file, so we wrap our raw PCM data in a Blob and give it a filename.
    // The content type 'audio/l16' with params might be more accurate, but 'audio/wav' is broadly accepted.
    form.append('file', new Blob([pcm_s16le], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'en'); // Or make this configurable via a header.
    form.append('response_format', 'json');
    form.append('temperature', '0');

    // Make the API call to Groq.
    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      },
      body: form
    });

    // Handle non-successful responses from Groq.
    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      return new Response(`Groq API Error: ${errorText}`, { status: groqResponse.status });
    }

    const { text } = await groqResponse.json();

    // Check for instruction mode to chain to Llama 3.
    if (req.headers.get("X-Mode") === "instruction") {
      const llm = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "llama3-8b-8192", // Or llama3-70b-8192
          messages: [
            { role: "system", content: "You are a helpful assistant. The user will provide text and an instruction. Apply the instruction to the text and output only the result." },
            { role: "user", content: text }
          ],
          stream: true,
        })
      });
      // Stream the LLM response directly back to the client.
      return new Response(llm.body, llm);
    }

    // Return the transcription text as a JSON object.
    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

### 2.3. Files to REFACTOR

| Path                            | What to Change                                                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/useTranscription.ts` | **Complete Overhaul.** Remove all state and refs for different modes (`currentMode`, `cloudEngine`, `localWorkerRef`, `sabRef`, etc.). See Section 3 for the new logic.                                                                    |
| `src/components/App.tsx`          | Remove UI controls for switching transcription modes/engines. The UI should be simplified to a single record/stop flow.                                                                                                                   |
| `src/components/Pill.tsx`         | Remove any engine-specific icons or logic. It should only display recording state (e.g., waveform animation).                                                                                                                             |
| `src/main.ts`                   | Remove all IPC handlers except for the clipboard/paste helpers. The `transcribe-` handlers are obsolete as the renderer will now `fetch` the worker directly.                                                                                 |
| `src/preload.ts`                | Remove the corresponding `transcribe-` functions from the `electron` API exposed to the renderer.                                                                                                                                          |
| `src/types/worker-messages.ts`  | Drastically simplify. Most message types can be deleted. You might only need a simple type for the final transcription result.                                                                                                               |
| `src/config/audio.ts`           | Remove constants related to SABs, buffer sizes, and any sample rates other than 48kHz (for input) and 16kHz (for processing).                                                                                                                |

---

## 3. The `useTranscription.ts` Refactor in Detail

The core of the client-side change is in this hook. It will be simplified to four key states: `ready`, `recording`, `processing`, and `error`.

**New Logic Flow:**

1.  **`start()` function:**
    *   Creates a `TransformStream`. This provides a `readable` and `writable` pair.
    *   Initiates a `fetch` call to your new Cloudflare Worker URL. The key is to use `{ method: 'POST', body: transformStream.readable, duplex: 'half' }`. This starts the upload immediately, streaming data as it becomes available.
    *   The `writable` part of the stream is stored in a ref (`writerRef.current`).
    *   The `AudioWorklet` is started.

2.  **`workletNode.port.onmessage`:**
    *   This event listener receives the `Int16Array` chunks from `audioworklet-processor.js`.
    *   It immediately writes each chunk into the `writerRef.current`.

3.  **`stop()` function:**
    *   Calls `writerRef.current.close()`. This signals the end of the stream to the `fetch` request and the Cloudflare Worker.
    *   Awaits the `fetch` response promise, which will resolve with the final JSON from the worker.
    *   Sets the `text` state with the transcription result.
    *   Calls `window.electron.insertTextAtCursor(text)`.

---

## 4. The Cleanup (Dependencies & Build)

*   **`package.json`**:
    *   **Remove** `@huggingface/transformers`, `onnxruntime-web`, and any other packages related to the local ASR or VAD.
*   **Vite Config (`vite.*.config.ts`)**:
    *   Remove any custom worker or WASM loading configurations that were added for the local pipeline.
*   **`.env` / `.env.example`**:
    *   The only required environment variable should be `GROQ_API_KEY` (for the worker). Client-side env vars for API keys can be removed.
*   **CI/CD (`.github/workflows`)**:
    *   Remove steps that download or cache large ASR models.

---

## 5. The Gauntlet (Validation Checklist)

- [ ] **Functional:** A 30-second dictation correctly transcribes and pastes the text.
- [ ] **Latency:** Measure the E2E time from `stop()` being called to text being pasted. Run 3 times for a 60s clip; the average should be under 1.8s.
- [ ] **Network:** In DevTools, confirm the `fetch` request body is streaming during recording, not sent in one blob at the end.
- [ ] **Memory:** With Activity Monitor / Task Manager, confirm the app's memory footprint does not grow significantly during a long (3-minute) recording. It should stay well under 300MB.
- [ ] **Build:** The final packaged application size (`.dmg`, `.exe`) should be significantly smaller (~40-70MB less) without the bundled models.
- [ ] **Error Handling:** Test what happens if the network connection is lost or the API key is invalid. The app should handle the error gracefully.

---

## 6. The Execution (Git & Rollout)

1.  Create a new feature branch: `git checkout -b feat/all-in-refactor`
2.  Perform all the file deletions in a single, clear commit.
3.  Implement the new files and refactor existing ones. Commit logically (e.g., "feat: implement streaming audio pipeline", "refactor: overhaul useTranscription hook").
4.  Deploy the new Cloudflare Worker.
5.  Thoroughly test against the validation checklist.
6.  Merge to `main`.

Ship it.
