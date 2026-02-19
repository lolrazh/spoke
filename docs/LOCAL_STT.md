# Local STT: Moonshine v2 Streaming Medium

## Overview

Spoke currently uses Groq's cloud Whisper API for speech-to-text. This document covers our Phase 1 evaluation of **Moonshine v2 Streaming Medium** as a fully local replacement — what we tried, what failed, what worked, and the final architecture.

**Final choice**: Moonshine Streaming Medium (245M params, 6.65% WER) loaded at FP16 via HuggingFace Transformers on MPS (Apple Silicon GPU), with streaming token output via `TextIteratorStreamer`.

---

## What We Tried (Chronological)

### Attempt 1: moonshine-voice SDK (Quantized ONNX) — REJECTED

**Package**: `pip install moonshine-voice` (v0.0.48)

**What it is**: Official Moonshine SDK with native ONNX Runtime inference. Provides `MicTranscriber`, `Transcriber`, `Stream`, and `TranscriptEventListener` classes. Downloads models automatically via `python -m moonshine_voice.download --language en`.

**Model downloaded**: `medium-streaming-en/quantized` (~289 MB total)
- Files: `adapter.ort`, `cross_kv.ort`, `decoder_kv.ort` (139MB), `encoder.ort` (90MB), `frontend.ort` (45MB), `streaming_config.json`, `tokenizer.bin`
- Path: `~/Library/Caches/moonshine_voice/download.moonshine.ai/model/medium-streaming-en/quantized`
- Arch enum: `ModelArch.MEDIUM_STREAMING` (value 5)

**API usage**:
```python
from moonshine_voice import Transcriber, MicTranscriber, TranscriptEventListener, get_model_for_language

model_path, model_arch = get_model_for_language("en")
# model_path = ~/Library/Caches/moonshine_voice/.../medium-streaming-en/quantized
# model_arch = ModelArch.MEDIUM_STREAMING (5)

# IMPORTANT: model_arch must be the enum, NOT the int value.
# Passing model_arch=5 causes: AttributeError: 'int' object has no attribute 'value'

transcriber = Transcriber(model_path=str(model_path), model_arch=model_arch)
```

**Results on clean WAV files**: Excellent. Beckett quote transcribed perfectly. 153ms TTFT, 1700ms total for 10s audio on CPU ONNX.

**Results on live mic**: Terrible. Garbled, wrong words, poor accuracy.

**Root cause**: The SDK only ships **quantized** (likely int8) ONNX models. The quantization degrades quality significantly on real-world mic audio (background noise, natural speech patterns, non-studio conditions). We confirmed:
- No non-quantized models available via the SDK's CDN (`/fp16`, `/fp32`, `/full`, `/unquantized` all return 404)
- All download URLs in the SDK source hardcode `/quantized` paths
- The official `python -m moonshine_voice.mic_transcriber` was also mediocre

**Streaming support**: Yes, via `TranscriptEventListener` callbacks:
- `on_line_started(event)` — new speech segment detected
- `on_line_text_changed(event)` — partial text update (most frequent)
- `on_line_completed(event)` — pause detected, segment finalized
- Works with both `Transcriber.add_audio()` and `MicTranscriber`

**Key gotcha**: `MicTranscriber` uses `sounddevice.InputStream` at 16kHz. Mac mic native rate is 48kHz — PortAudio handles resampling, but this isn't the quality issue (confirmed by testing 16kHz direct vs native-resampled recordings).

### Attempt 2: HuggingFace Transformers (Full Precision) — ACCEPTED

**Package**: `pip install transformers torch torchaudio`

**Model**: `UsefulSensors/moonshine-streaming-medium` on HuggingFace
- Format: `model.safetensors` (1.06 GB, full precision)
- Same 245M parameter model, just not quantized

**API usage**:
```python
from transformers import MoonshineStreamingForConditionalGeneration, AutoProcessor

MODEL_ID = "UsefulSensors/moonshine-streaming-medium"

processor = AutoProcessor.from_pretrained(MODEL_ID)
model = MoonshineStreamingForConditionalGeneration.from_pretrained(MODEL_ID)
model = model.to("mps").to(torch.float16)  # Apple Silicon GPU, half precision

inputs = processor(audio_float32, return_tensors="pt", sampling_rate=16000)
inputs = inputs.to("mps", torch.float16)

# Prevent hallucination with max_length limit
token_limit_factor = 6.5 / 16000
seq_lens = inputs.attention_mask.sum(dim=-1)
max_length = int((seq_lens * token_limit_factor).max().item())

generated_ids = model.generate(**inputs, max_length=max_length)
text = processor.decode(generated_ids[0], skip_special_tokens=True)
```

**Results on live mic**: Much better. User confirmed quality was good.

**Performance (MPS FP16, Apple Silicon)**:
| Metric | Value |
|---|---|
| Model load (cold) | ~6.8s |
| TTFT | ~250ms |
| Inference (10s audio) | ~430ms |
| Real-time factor | ~23x faster than real-time |

**Streaming token output**: Yes, via `TextIteratorStreamer`:
```python
from threading import Thread
from transformers import TextIteratorStreamer

streamer = TextIteratorStreamer(processor.tokenizer, skip_special_tokens=True)
gen_kwargs = {**inputs, "max_length": max_length, "streamer": streamer}

thread = Thread(target=model.generate, kwargs=gen_kwargs)
thread.start()

transcript = ""
for token_text in streamer:
    if token_text:
        transcript += token_text
        print(transcript)  # partial result, word by word

thread.join()
```

Each token arrives ~10-20ms apart. Not true real-time ASR (model needs full audio before generating), but tokens stream out during decoding so the UI can show progressive text.

**Important**: The model auto-downloads on first `from_pretrained()` call (~1.06GB). Cached at `~/.cache/huggingface/hub/models--UsefulSensors--moonshine-streaming-medium/`.

---

## What We Did NOT Try

- **mlx-whisper**: Apple MLX framework with Whisper models. Would be worth evaluating if Moonshine quality is insufficient.
- **faster-whisper**: CTranslate2-based Whisper. Supports int8/fp16/fp32. Mature ecosystem.
- **MLX port of Moonshine**: Doesn't exist yet as of Feb 2026. Could be built if needed.
- **Non-quantized ONNX export**: Could theoretically export the safetensors model to ONNX at FP16 for use with the moonshine-voice SDK's streaming API. Not attempted.

---

## Mic Audio Diagnostics

We built `diagnose_mic.py` to investigate the mic quality issue. Key findings:

- **Default device**: MacBook Air Microphone (device index 1)
- **Native sample rate**: 48000 Hz
- **16kHz support**: Yes (via PortAudio resampling)
- **All common rates supported**: 8000, 16000, 22050, 44100, 48000 Hz

The mic audio quality itself was fine — the issue was purely the quantized model's inability to handle real-world audio.

---

## File Inventory (`local-stt/`)

All files are gitignored. The directory lives at project root.

| File | Purpose | Status |
|---|---|---|
| `.venv/` | Python 3.11 venv | Active |
| `test_moonshine.py` | Quantized SDK test (mic + file) | Superseded — kept for reference |
| `test_moonshine_hf.py` | Full-precision HF Transformers test (mic + file) | Working |
| `test_streaming_hf.py` | Token streaming proof-of-concept | Working |
| `test_mic_hf.py` | Interactive mic test with streaming output | Working — primary test script |
| `sidecar.py` | Sidecar for Spoke integration (stdin PCM → stdout JSON) | Working — Phase 2 entry point |
| `wav_to_pcm.py` | WAV → raw PCM16 converter for testing sidecar | Working |
| `diagnose_mic.py` | Mic device/sample rate diagnostics | Working |

### Dependencies installed in venv

```
moonshine-voice==0.0.48     # For test audio assets + old SDK reference
transformers==5.2.0          # Model loading + inference + streaming
torch==2.10.0                # PyTorch backend (MPS support)
torchaudio==2.10.0           # Audio resampling
numpy, sounddevice           # Audio capture + processing
```

---

## Sidecar Protocol

The sidecar (`sidecar.py`) is what Spoke's Electron main process will spawn in Phase 2.

**Input**: Raw PCM16 audio (s16le, 16kHz, mono) on **stdin**

**Output**: JSON lines on **stdout**:
```jsonl
{"type":"partial","text":"Ever "}
{"type":"partial","text":"Ever tried, "}
{"type":"partial","text":"Ever tried, ever failed, "}
{"type":"done","transcript":"Ever tried, ever failed, no matter.","metrics":{"model_load_ms":6720,"audio_duration_ms":9963,"inference_ms":427,"ttft_ms":260,"word_count":12}}
```

**Diagnostics**: Human-readable logs on **stderr**

**Invocation**:
```bash
# From Electron main process (conceptual)
cat audio.pcm | python sidecar.py

# With ffmpeg conversion from WebM
ffmpeg -i audio.webm -f s16le -ar 16000 -ac 1 - 2>/dev/null | python sidecar.py
```

---

## Phase 2 Integration Plan (Sketch)

```
Current:  Renderer → HTTP POST /transcribe → Cloudflare Worker → Groq API → text
New:      Renderer → IPC (PCM audio) → Main → Python sidecar (stdin/stdout) → text
```

### Key changes needed

| File | Change |
|---|---|
| `src/utils/audioDecoder.ts` | **New** — decode WebM Blob → PCM16 via OfflineAudioContext |
| `src/preload.ts` | Add `window.electron.transcribeLocal()` IPC bridge |
| `src/main.ts` | Add `ipcMain.handle('transcribe-local')` — spawn sidecar, pipe audio |
| `src/hooks/useTranscription.ts` | Add local mode: call `transcribeLocal()` instead of `fetch(/transcribe)` |
| `src/config/api.ts` | Add `isLocalMode()` flag |
| `local-stt/sidecar.py` | Already built |

### What stays the same
- `App.tsx` state machine (transcription-agnostic)
- `audioRecorder.ts` (recording pipeline)
- `worker/` (kept as cloud fallback)
- Text insertion flow (`insertText()`)

### What gets skipped in local mode
- `/prepare` endpoint (OCR context)
- `/transcribe` endpoint
- LLM enhancement (router + enhance)
- Quota tracking

### Cold start mitigation
Model load is ~6.8s. Options:
1. **Pre-warm on app launch**: Spawn sidecar process at startup, keep alive
2. **Lazy load on first use**: Accept 6.8s delay on first dictation only
3. **Pre-warm on first focus**: Start loading when app gains focus

Pre-warm on app launch is recommended — the sidecar idles at ~300MB RAM.

---

## Benchmarks Summary

| Config | Inference (10s) | TTFT | Quality (mic) | Model Size |
|---|---|---|---|---|
| moonshine-voice SDK (int8 ONNX, CPU) | 1,738ms | 151ms | Bad | 289 MB |
| HF Transformers (FP16, MPS) | 427ms | 260ms | Good | 1.06 GB |
| Groq Whisper Cloud (current) | ~800-1500ms | N/A | Good | N/A |

The local FP16 model is faster than the current cloud pipeline and runs entirely on-device.
