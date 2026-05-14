# Local Inference TODO

Target: ship one production local transcription engine using `whisper-large-v3-turbo-4bit` on MLX.

Rules:
- No fallback local models.
- No renderer-side inference.
- No dependency on user-installed Python in packaged builds.
- Commit every meaningful slice.
- Delete Moonshine code once Whisper is working.

## 1. Model Contract

- [x] Define the exact model ID: `mlx-community/whisper-large-v3-turbo-4bit` unless implementation proves the ASR-specific artifact is required.
- [x] Define required files and final install layout under app-managed `userData` (`weights.safetensors`, not HF's source filename).
- [x] Extend the model manifest to support multiple files, file roles, sizes, checksums, and model family.
- [x] Add model identity validation so stale Moonshine files cannot count as installed.
- [ ] Decide whether runtime downloads from Hugging Face are allowed only for dev, with production using our CDN/release bucket.

## 2. Installer

- [x] Replace the Moonshine manifest URL and file assumptions.
- [x] Download all Whisper model files atomically into a temp directory.
- [x] Verify every file with SHA256 before marking ready.
- [x] Persist model family, model ID, version, and file manifest version.
- [ ] Surface clean install states to the Models tab: not installed, downloading, verifying, ready, broken.
- [ ] Make removal delete all local model files and stop the sidecar first.

## 3. Sidecar Runtime

- [x] Replace the Moonshine sidecar with a Whisper MLX sidecar.
- [x] Keep the daemon protocol: length-prefixed PCM16 in, JSON lines out.
- [x] Emit structured events: `ready`, `partial` if supported, `done`, `error`.
- [x] Include metrics: load time, audio duration, inference time, peak MLX memory, cache memory, model ID.
- [x] Add no-speech handling inside the sidecar.
- [x] Keep one-shot mode for smoke tests.
- [ ] Remove `moonshine_mlx.py` and `convert_weights.py` after the Whisper sidecar is verified.

## 4. Electron Lifecycle

- [x] Add a shared `spawnPromise` so startup and first transcription cannot double-spawn sidecars.
- [x] Make sidecar errors typed enough for UI/log categories.
- [ ] Keep serialized transcription requests unless we intentionally add a request ID protocol.
- [ ] Kill sidecar on model removal, provider switch away from local, and app quit.
- [x] Make dev and packaged mode use the same installed model layout.

## 5. Packaging

- [x] Update sidecar build script for Whisper/MLX dependencies.
- [ ] Build a standalone macOS arm64 `spoke-stt` binary.
- [ ] Ensure Electron Forge includes the sidecar binary in packaged resources.
- [ ] Test packaged app on a clean Mac account without local Python or repo files.
- [ ] Confirm signing/notarization still works with the sidecar binary.

## 6. UI Copy

- [x] Replace remaining Moonshine copy with Whisper turbo copy.
- [ ] Show installed model name/version in Models tab.
- [ ] Show model size before install.
- [ ] Keep provider settings separate from app defaults.

## 7. Cleanup

- [ ] Delete tracked Moonshine runtime files.
- [ ] Delete ignored local Moonshine weights and old scratch scripts from the working folder.
- [ ] Update tests from `moonshine-v2` IDs to Whisper IDs.
- [ ] Remove stale comments mentioning Moonshine or generic local STT where a concrete Whisper contract exists.

## Done Means

- [ ] Fresh checkout can run dev local transcription after installing the Whisper model.
- [ ] Packaged app can install the model and transcribe without user Python.
- [ ] Silence does not paste hallucinated text.
- [ ] Switching away from local stops the sidecar.
- [ ] Removing the model removes files and prevents local transcription.
- [ ] Worktree has no tracked Moonshine implementation left.
