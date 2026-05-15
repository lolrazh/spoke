# Local Inference TODO

Target: ship one production local transcription engine using `whisper-large-v3-turbo-4bit` on MLX.

Rules:
- No fallback local models.
- No renderer-side inference.
- No dependency on user-installed Python in packaged builds.
- Commit every meaningful slice.
- Delete legacy local STT code once Whisper is working.

## 1. Model Contract

- [x] Define the exact model ID: `mlx-community/whisper-large-v3-turbo-4bit` unless implementation proves the ASR-specific artifact is required.
- [x] Define required files and final install layout under app-managed `userData` (`weights.safetensors`, not HF's source filename).
- [x] Extend the model manifest to support multiple files, file roles, sizes, checksums, and model family.
- [x] Add model identity validation so stale legacy files cannot count as installed.
- [x] Decide model downloads: the app installer uses a checked-in, pinned Hugging Face manifest; the sidecar runtime never downloads.

## 2. Installer

- [x] Replace the legacy manifest URL and file assumptions.
- [x] Download all Whisper model files atomically into a temp directory.
- [x] Verify every file with SHA256 before marking ready.
- [x] Persist model family, model ID, version, and file manifest version.
- [x] Surface clean install states to the Models tab: not installed, downloading, verifying, ready, broken.
- [x] Make removal delete all local model files and stop the sidecar first.

## 3. Sidecar Runtime

- [x] Replace the legacy sidecar with a Whisper MLX sidecar.
- [x] Keep the daemon protocol: length-prefixed PCM16 in, JSON lines out.
- [x] Emit structured events: `ready`, `partial` if supported, `done`, `error`.
- [x] Include metrics: load time, audio duration, inference time, peak MLX memory, cache memory, model ID.
- [x] Add no-speech handling inside the sidecar.
- [x] Keep one-shot mode for smoke tests.
- [x] Remove legacy conversion/model files after the Whisper sidecar is verified.

## 4. Electron Lifecycle

- [x] Add a shared `spawnPromise` so startup and first transcription cannot double-spawn sidecars.
- [x] Make sidecar errors typed enough for UI/log categories.
- [x] Keep serialized transcription requests unless we intentionally add a request ID protocol.
- [x] Kill sidecar on model removal, provider switch away from local, and app quit.
- [x] Make dev and packaged mode use the same installed model layout.

## 5. Packaging

- [x] Update sidecar build script for Whisper/MLX dependencies.
- [x] Build a standalone macOS arm64 `spoke-stt` binary.
- [x] Ensure Electron Forge includes the sidecar binary in packaged resources.
- [x] Verify packaged, signed sidecar starts and loads the Whisper model without user Python.
- [ ] Test packaged app on a clean Mac account without local Python or repo files.
- [ ] Confirm notarization/stapling still works with the sidecar binary.

## 6. UI Copy

- [x] Replace remaining legacy local-model copy with Whisper turbo copy.
- [x] Show installed model name/version in Models tab.
- [x] Show model size before install.
- [x] Keep provider settings separate from app defaults.

## 7. Cleanup

- [x] Delete tracked legacy local STT runtime files.
- [x] Delete ignored legacy local-model weights and old scratch scripts from the working folder.
- [x] Update tests from legacy model IDs to Whisper IDs.
- [x] Remove stale comments mentioning generic local STT where a concrete Whisper contract exists.

## 8. Performance

- [x] Add a reproducible local STT benchmark harness.
- [x] Benchmark MLX fast attention modes and keep them disabled by default.
- [x] Benchmark decode sample length caps and keep them disabled by default.
- [x] Break down warm inference into preprocessing, encoder, language detection, and decoder timing.
- [x] Benchmark pinned English transcription versus auto language detection.
- [ ] Re-run a clean pinned-English control after machine cooldown and low background load.
- [x] Add benchmark metadata for machine load/thermal caveats so noisy runs are obvious.
- [x] Inspect MLX Whisper encoder shape constraints: conv stack, positional embeddings, and required frame count.
- [x] Test whether shorter effective mel windows can reduce encoder work without breaking output quality.
- [x] If short-window encoding is impossible in stock MLX Whisper, document why and do not keep dead knobs.
- [ ] Investigate reusing encoded audio features only for `auto` language mode, not the default pinned-English path.
- [ ] Evaluate upstream MLX batched decoding work for long-file throughput only; do not mix it into short dictation unless it improves latency.
- [ ] Evaluate WhisperKit/Core ML as a separate native engine spike if MLX encoder latency remains the wall.
- [ ] Keep production default on pinned `en` unless multilingual UX becomes a hard requirement.
- [ ] Define pass/fail gates for any speed change: no WER regression on benchmark corpus, no hallucination regression on silence/noise, lower mean and P95 wall time, and no meaningful memory increase.

## Done Means

- [ ] Fresh checkout can run dev local transcription after installing the Whisper model.
- [ ] Packaged app can install the model and transcribe without user Python.
- [x] Silence does not paste hallucinated text.
- [x] Switching away from local stops the sidecar.
- [x] Removing the model removes files and prevents local transcription.
- [x] Worktree has no tracked legacy local STT implementation left.
