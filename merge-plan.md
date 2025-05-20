## 0 Commit pre-flight

| Step    | Command / action                                                  | Why                                                                           |
| ------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **0-a** | `git switch -c feat/whisper-sequential-buffer`                    | New feature branch                                                            |
| **0-b** | `pnpm test:e2e-dictation` (or whatever quick smoke test you have) | Establish a baseline so you can measure WER / latency deltas commit-by-commit |

---

## 1 Bring back sequential buffering (kill chunk + stride)

### 1-a Remove the streaming-specific constants

```diff
-const CHUNK_S        = 7;
-const STRIDE_S       = 2;
-const CHUNK_SAMPLES  = CHUNK_S * TARGET_SAMPLE_RATE;
-const STRIDE_SAMPLES = STRIDE_S * TARGET_SAMPLE_RATE;
```

### 1-b Delete `processAvailableAudio()` and its call-site

You no longer need to detect “enough for the next chunk”.
Instead, keep the **pull loop** but emit partials on a time threshold *exactly* like the old worker:

```ts
const PARTIAL_INTERVAL_S = 10;       // unchanged
let nextDecodeStart16k    = 0;       // copy from old worker
```

### 1-c Replace the body of the loop

```diff
- pullAndProcessAudio();
- await processAvailableAudio();
+ pullAndProcessAudio();      // still fills the big 16 kHz buffer
+ await maybeEmitPartial();   // ported verbatim from old worker
```

`maybeEmitPartial()` is a direct transplant:
*slice from* `nextDecodeStart16k` → `current16kWriteOffset`, run `await asr(slice)`, diff against `lastPartialText`, bump the cursor.

### 1-d Delete `chunk_length_s` and `stride_length_s` from the pipeline init

```diff
-    chunk_length_s: CHUNK_S,
-    stride_length_s: [STRIDE_S, STRIDE_S],
```

That lets the ↓ Hugging Face Whisper pipeline fall back to its **internal sliding window**.

---

## 2 Restore the *good* resampler

### 2-a Extract old sinc-based resampler into `audio/resample.ts`

```ts
export function resample48kTo16k(input: Float32Array): Float32Array {
  // …copy your polyphase / sinc routine here…
}
```

### 2-b Use it in the AudioWorklet processor **not** in the worker

(keep the worker CPU for decoding, not resampling).
In `audioworklet-processor.js`:

```ts
const out = resample48kTo16k(channelData[0]);   // mono
ringBuffer.write(out);
```

### 2-c Delete the naive `resampleTo16kHz()` helper from *local-worker.ts*.

---

## 3 Thread & pull-loop tweaks (speed without WER hit)

* In the worker preamble:

  ```ts
  env.backends.wasm.numThreads = navigator.hardwareConcurrency ?? 4;
  ```
* In `startPullLoop()` change delay → **100 ms**.
  It keeps latency sub-200 ms but leaves head-room for the decoder.

---

## 4 Prompt hygiene & diff logic

1. Bring back **diff-and-send**, drop the “suspicious-overlap” / rollback logic (it only exists to paper-over chunking artefacts).
2. Never lowercase / strip punctuation inside the worker; leave normalisation to a tiny post-processor in the UI (sentence-case pass).

---

## 5 Hook (`useTranscription.ts`) alignment

* **Mode toggles stay** (local vs cloud).
* For local mode, remove every reference to `currentMode === 'local' && CHUNK_S…` etc.
* When you receive a `'partial'` message now, it already *is* a diff.

  ```ts
  setText(prev => (prev + ' ' + delta).trim());
  ```

No overlap merge needed.

---

## 6 Test matrix & benches

| Scenario             | Old worker (baseline) | New sequential worker |
| -------------------- | --------------------- | --------------------- |
| 1-min podcast, EN-US | WER x                 | *expect ≤ x + 0.3*    |
| Word latency (ms)    | 170                   | *expect ≤ 170 ± 20*   |
| CPU % (M1 Air)       | 80-85                 | *expect identical*    |

Run the WER harness before and after to prove the refactor is a net win.

---

## 7 Docs & clean-up

* Update `docs/architecture.md` – remove chunk/stride diagram, insert sequential buffer diagram.
* Add resampler explanation in `audio/README.md`.
* Edit `package.json` scripts: remove stale `test:stride`.

---

## 8 Commit guide

1. **chore(worker): drop chunk/stride & resurrect sequential buffer**
2. **feat(audio): polyphase 48 k → 16 k resampler (worklet)**
3. **perf(wasm): enable multithread + pull loop 100 ms**
4. **refactor(prompt): revert to diff-and-merge, delete LA**
5. **docs: update pipeline diagrams**

Each commit should leave the build green.