#!/usr/bin/env python3
"""
Spoke MLX STT sidecar supporting Whisper, Cohere, Parakeet, and Nemotron ASR.

The engine family is selected with --family {whisper,cohere,parakeet,nemotron} (default
whisper for back-compat). Whisper uses mlx_whisper (large-v3 turbo 4-bit);
Cohere uses mlx-speech (CohereAsrModel); Parakeet uses parakeet-mlx (TDT 0.6b
v2, 8-bit). Heavy per-family imports are loaded lazily so that selecting one
family never imports the others.

Daemon mode loads the model once, emits {"type":"ready"}, then reads requests
as two length-prefixed frames on stdin:
  1. A JSON metadata frame: 4-byte little-endian length + UTF-8 JSON object
     (currently supports an optional "prompt" string used as a vocabulary/
     decoding hint). An empty object ("{}") means no options.
  2. A raw audio frame: 4-byte little-endian length + raw PCM16 mono 16 kHz
     audio.
A zero-length metadata frame (i.e. the 4-byte length alone, with no JSON or
audio frame following) is a shutdown request.

Protocol stdout events:
  {"type":"ready"}
  {"type":"partial","text":"..."}
  {"type":"done","transcript":"...","metrics":{...}}
  {"type":"error","message":"...","code":"..."}
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import time
import traceback
import types
from pathlib import Path
from typing import Any

import mlx.core as mx
import numpy as np

# Whisper model identity / files.
WHISPER_MODEL_ID = "spokedotso/whisper-large-v3-turbo-4bit"
WHISPER_MODEL_DISPLAY_NAME = "Whisper Large-v3 Turbo"
WHISPER_REQUIRED_MODEL_FILES = (
    "config.json",
    "weights.safetensors",
    "multilingual.tiktoken",
)

# Cohere model identity / files.
COHERE_MODEL_ID = "spokedotso/cohere-transcribe-03-2026-mlx-4bit"
COHERE_MODEL_DISPLAY_NAME = "Cohere Transcribe 03-2026 4-bit"
# Keep in sync with the `requiredFilePaths` for Cohere in
# src/main/localModelContract.ts (the install-completeness gate).
COHERE_REQUIRED_MODEL_FILES = (
    "config.json",
    "model.safetensors",
    "tokenizer.json",
    "tokenizer.model",
)

# Parakeet model identity / files.
PARAKEET_MODEL_ID = "spokedotso/parakeet-tdt-0.6b-v2-mlx-6bit"
PARAKEET_MODEL_DISPLAY_NAME = "Parakeet TDT 0.6B v2 6-bit"
# Keep in sync with the `requiredFilePaths` for Parakeet in
# src/main/localModelContract.ts (the install-completeness gate).
PARAKEET_REQUIRED_MODEL_FILES = (
    "config.json",
    "model.safetensors",
    "mel_filters.npy",
)
# The checkpoint is quantized with mlx.nn.quantize using these settings; the
# module tree must be quantized identically before load_weights() can accept
# the packed weights (parakeet-mlx's from_pretrained has no quantized path).
PARAKEET_QUANT_BITS = 6
PARAKEET_QUANT_GROUP_SIZE = 64

# Nemotron model identity / files. The model is already quantized by the MLX
# conversion, and mlx-audio restores that layout from config.json.
NEMOTRON_MODEL_ID = "mlx-community/nemotron-3.5-asr-streaming-0.6b-8bit"
NEMOTRON_MODEL_DISPLAY_NAME = "Nemotron 3.5 ASR Streaming 0.6B 8-bit"
NEMOTRON_REQUIRED_MODEL_FILES = (
    "config.json",
    "model.safetensors",
    "tokenizer.model",
    "vocab.txt",
)

# All engine families consume 16 kHz mono PCM. Keep a single shared constant;
# the Whisper and Parakeet engines assert it matches their model's rate.
SAMPLE_RATE = 16000

NO_SPEECH_THRESHOLD = 0.6
LOW_LOGPROB_THRESHOLD = -1.0

# Conservative near-digital-silence gate. Whisper's own no_speech handling still
# decides ambiguous low-volume clips.
SILENCE_RMS_THRESHOLD = 0.0005
SILENCE_PEAK_THRESHOLD = 0.003
LOW_ENERGY_RMS_THRESHOLD = 0.004
LOW_ENERGY_PEAK_THRESHOLD = 0.025
LOW_SPECTRAL_ENTROPY_THRESHOLD = 0.22
NOISE_SPECTRAL_ENTROPY_THRESHOLD = 0.75
NOISE_SPECTRAL_FLATNESS_THRESHOLD = 0.35
SPECTRAL_FRAME_LENGTH = 400
SPECTRAL_HOP_LENGTH = 160
SPECTRAL_ACTIVE_RMS_THRESHOLD = 0.0005
FAST_ATTENTION_MODE = os.environ.get(
    "SPOKE_STT_FAST_ATTENTION", "encoder-cross"
).strip().lower()
SAMPLE_LEN_LIMIT = os.environ.get("SPOKE_STT_SAMPLE_LEN", "").strip()
PROFILE_MODE = os.environ.get("SPOKE_STT_PROFILE", "0").strip().lower()
WARMUP_MODE = os.environ.get("SPOKE_STT_WARMUP", "1").strip().lower()
CLEAR_CACHE_MODE = os.environ.get("SPOKE_STT_CLEAR_CACHE", "1").strip().lower()
ENCODER_EVAL_INTERVAL = os.environ.get(
    "SPOKE_STT_ENCODER_EVAL_INTERVAL", "1"
).strip()
ENCODER_ATTENTION_CHUNK_SIZE = os.environ.get(
    "SPOKE_STT_ENCODER_ATTENTION_CHUNK_SIZE", "0"
).strip()
DYNAMIC_PADDING_FRAMES = os.environ.get(
    "SPOKE_STT_DYNAMIC_PADDING_FRAMES", "0"
).strip()
PARAKEET_ENCODER_EVAL_INTERVAL = os.environ.get(
    "SPOKE_STT_PARAKEET_ENCODER_EVAL_INTERVAL", "1"
).strip()
PARAKEET_FUSED_QKV_MODE = os.environ.get(
    "SPOKE_STT_PARAKEET_FUSED_QKV", "1"
).strip().lower()
PARAKEET_FAST_DECODE_MODE = os.environ.get(
    "SPOKE_STT_PARAKEET_FAST_DECODE", "1"
).strip().lower()
WARMUP_SAMPLE_LEN = 8


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def emit_error(message: str, code: str = "local_stt_error") -> None:
    emit({"type": "error", "message": message, "code": code})


def log_exception(exc: Exception, *, include_traceback: bool) -> None:
    if include_traceback:
        log(traceback.format_exc())
        return
    log(f"sidecar: {exc}")


def read_exact(stream, length: int) -> bytes:
    chunks: list[bytes] = []
    remaining = length
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            raise EOFError("stdin closed")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def pcm16_to_float32(raw: bytes) -> np.ndarray:
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def validate_weights_dir(weights_dir: Path, required_files: tuple[str, ...]) -> None:
    missing = [name for name in required_files if not (weights_dir / name).exists()]
    if missing:
        raise FileNotFoundError(
            "Local model is incomplete. Missing: " + ", ".join(missing)
        )


def reset_peak_memory() -> None:
    try:
        mx.reset_peak_memory()
    except Exception:
        pass


def clear_cache() -> None:
    try:
        mx.clear_cache()
    except Exception:
        pass


def clear_cache_if_enabled() -> None:
    if is_enabled(CLEAR_CACHE_MODE):
        clear_cache()


def memory_snapshot() -> dict[str, int]:
    snapshot: dict[str, int] = {}
    for key, getter in (
        ("peak_memory_bytes", mx.get_peak_memory),
        ("active_memory_bytes", mx.get_active_memory),
        ("cache_memory_bytes", mx.get_cache_memory),
    ):
        try:
            snapshot[key] = int(getter())
        except Exception:
            snapshot[key] = 0
    return snapshot


def get_sample_len_limit() -> int | None:
    normalized = SAMPLE_LEN_LIMIT.lower()
    if normalized in ("", "0", "none", "default"):
        return None
    try:
        value = int(SAMPLE_LEN_LIMIT)
    except ValueError:
        raise ValueError("SPOKE_STT_SAMPLE_LEN must be a positive integer")
    if value <= 0:
        raise ValueError("SPOKE_STT_SAMPLE_LEN must be a positive integer")
    return value


def get_dynamic_padding_frames() -> int:
    """Return extra 10 ms mel frames kept after the real utterance.

    Zero is the compatibility switch for Whisper's stock 30-second padding.
    """
    try:
        value = int(DYNAMIC_PADDING_FRAMES)
    except ValueError as exc:
        raise ValueError(
            "SPOKE_STT_DYNAMIC_PADDING_FRAMES must be a non-negative integer"
        ) from exc
    if value < 0:
        raise ValueError(
            "SPOKE_STT_DYNAMIC_PADDING_FRAMES must be a non-negative integer"
        )
    return value


def is_enabled(value: str) -> bool:
    return value in ("1", "true", "yes", "on")


def synthetic_warmup_audio() -> np.ndarray:
    """Small deterministic speech-like signal used only to compile MLX kernels."""
    duration_s = 0.75
    t = np.linspace(0.0, duration_s, int(SAMPLE_RATE * duration_s), endpoint=False)
    envelope = np.minimum(1.0, np.linspace(0.0, 8.0, t.size)) * np.minimum(
        1.0, np.linspace(8.0, 0.0, t.size)
    )
    carrier = (
        0.045 * np.sin(2 * np.pi * 180 * t)
        + 0.025 * np.sin(2 * np.pi * 430 * t)
        + 0.015 * np.sin(2 * np.pi * 920 * t)
    )
    return (carrier * envelope).astype(np.float32)


def audio_stats(audio: np.ndarray) -> dict[str, float | int | bool]:
    duration_ms = (len(audio) / SAMPLE_RATE) * 1000
    if audio.size == 0:
        return {
            "audio_duration_ms": 0,
            "audio_rms": 0.0,
            "audio_peak": 0.0,
            "is_silence": True,
            "is_no_speech": True,
            "spectral_entropy": 0.0,
            "spectral_flatness": 0.0,
            "active_frame_ratio": 0.0,
        }

    centered = audio - float(np.mean(audio))
    rms = float(np.sqrt(np.mean(np.square(centered, dtype=np.float64))))
    peak = float(np.max(np.abs(centered)))
    is_silence = rms < SILENCE_RMS_THRESHOLD and peak < SILENCE_PEAK_THRESHOLD
    spectral = spectral_stats(centered)
    is_low_energy = rms < LOW_ENERGY_RMS_THRESHOLD and peak < LOW_ENERGY_PEAK_THRESHOLD
    is_tonal = spectral["spectral_entropy"] < LOW_SPECTRAL_ENTROPY_THRESHOLD
    is_noise_like = (
        spectral["spectral_entropy"] > NOISE_SPECTRAL_ENTROPY_THRESHOLD
        and spectral["spectral_flatness"] > NOISE_SPECTRAL_FLATNESS_THRESHOLD
    )
    is_no_speech = is_silence or is_low_energy or is_tonal or is_noise_like

    return {
        "audio_duration_ms": round(duration_ms),
        "audio_rms": rms,
        "audio_peak": peak,
        "is_silence": is_silence,
        "is_no_speech": is_no_speech,
        **spectral,
    }


def spectral_stats(audio: np.ndarray) -> dict[str, float]:
    if audio.size < SPECTRAL_FRAME_LENGTH:
        return {
            "spectral_entropy": 0.0,
            "spectral_flatness": 0.0,
            "active_frame_ratio": 0.0,
        }

    window = np.hanning(SPECTRAL_FRAME_LENGTH).astype(np.float32)
    entropy_values: list[float] = []
    flatness_values: list[float] = []
    frame_count = 0

    for start in range(0, len(audio) - SPECTRAL_FRAME_LENGTH + 1, SPECTRAL_HOP_LENGTH):
        frame_count += 1
        frame = audio[start : start + SPECTRAL_FRAME_LENGTH]
        frame_rms = float(np.sqrt(np.mean(np.square(frame, dtype=np.float64))))
        if frame_rms < SPECTRAL_ACTIVE_RMS_THRESHOLD:
            continue

        spectrum = np.abs(np.fft.rfft((frame - float(np.mean(frame))) * window)) ** 2
        spectrum = spectrum[2:] + 1e-12
        total = float(np.sum(spectrum))
        if total <= 1e-12:
            continue

        probabilities = spectrum / total
        entropy = float(
            -np.sum(probabilities * np.log(probabilities)) / np.log(len(probabilities))
        )
        flatness = float(np.exp(np.mean(np.log(spectrum))) / np.mean(spectrum))
        entropy_values.append(entropy)
        flatness_values.append(flatness)

    active_frames = len(entropy_values)
    return {
        "spectral_entropy": float(np.mean(entropy_values)) if entropy_values else 0.0,
        "spectral_flatness": float(np.mean(flatness_values)) if flatness_values else 0.0,
        "active_frame_ratio": active_frames / frame_count if frame_count else 0.0,
    }


def build_metrics(
    *,
    model_id: str,
    stats: dict[str, float | int | bool],
    inference_ms: int,
    transcript: str,
    language: str | None,
    segment_count: int,
    memory: dict[str, int],
    model_load_ms: int,
    model_load_peak_memory_bytes: int,
    sample_len: int | None = None,
    timings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Shared metrics shape emitted by every engine's done event.

    Whisper-only timing fields (mel_ms/encoder_ms/decoder_ms/etc.) default to 0
    when an engine does not produce them, so the metrics keys stay consistent.
    """
    timings = timings or {}
    return {
        "model_id": model_id,
        "decode_sample_len": sample_len,
        "model_load_ms": model_load_ms or 0,
        "model_load_peak_memory_bytes": model_load_peak_memory_bytes,
        "audio_duration_ms": stats["audio_duration_ms"],
        "audio_rms": stats["audio_rms"],
        "audio_peak": stats["audio_peak"],
        "is_silence": stats["is_silence"],
        "is_no_speech": stats["is_no_speech"],
        "spectral_entropy": stats["spectral_entropy"],
        "spectral_flatness": stats["spectral_flatness"],
        "active_frame_ratio": stats["active_frame_ratio"],
        "inference_ms": inference_ms,
        "audio_analysis_ms": timings.get("audio_analysis_ms", 0),
        "mel_ms": timings.get("mel_ms", 0),
        "language_detection_ms": timings.get("language_detection_ms", 0),
        "encoder_ms": timings.get("encoder_ms", 0),
        "decoder_ms": timings.get("decoder_ms", 0),
        "postprocess_ms": timings.get("postprocess_ms", 0),
        "profile_enabled": timings.get("profile_enabled", False),
        "ttft_ms": None,
        "word_count": len(transcript.split()) if transcript else 0,
        "language": language,
        "segment_count": segment_count,
        **memory,
    }


class Engine:
    """Common engine interface.

    load()    -> load weights into memory.
    warmup()  -> optionally compile kernels (no output emitted).
    transcribe(audio, prompt) -> emit a {"type":"done", ...} event for one
        request. `prompt` is an optional vocabulary/decoding hint string;
        engines that cannot use it should ignore it rather than error.
    """

    def load(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def warmup(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def transcribe(
        self, audio: np.ndarray, prompt: str | None = None
    ) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    @property
    def supports_streaming(self) -> bool:
        return False

    def stream(self, read_pcm_frame) -> None:  # pragma: no cover - interface
        raise RuntimeError("This model does not support live streaming.")


# ---------------------------------------------------------------------------
# Whisper engine (mlx_whisper). Heavy imports happen lazily in load().
# ---------------------------------------------------------------------------


# Module-level holders for the whisper helpers, populated by _import_whisper().
_whisper_imported = False
_w: dict[str, Any] = {}


def _import_whisper() -> None:
    """Lazily import mlx_whisper submodules. Only the whisper path triggers this."""
    global _whisper_imported
    if _whisper_imported:
        return

    # mlx_whisper.__init__ imports the high-level transcribe module, which pulls
    # SciPy/Numba for word timestamps. This sidecar uses a lean lower-level
    # decode path, so stub that module before importing package submodules.
    transcribe_stub = types.ModuleType("mlx_whisper.transcribe")
    transcribe_stub.transcribe = None
    sys.modules.setdefault("mlx_whisper.transcribe", transcribe_stub)

    from mlx_whisper.audio import (
        HOP_LENGTH,
        N_FRAMES,
        N_SAMPLES,
        SAMPLE_RATE as WHISPER_SAMPLE_RATE,
        log_mel_spectrogram,
        pad_or_trim,
    )
    from mlx_whisper.decoding import DecodingOptions
    from mlx_whisper.load_models import load_model
    from mlx_whisper.tokenizer import get_tokenizer
    from mlx_whisper.whisper import AudioEncoder
    from mlx_whisper.whisper import MultiHeadAttention

    if WHISPER_SAMPLE_RATE != SAMPLE_RATE:
        raise RuntimeError(
            f"Whisper sample rate {WHISPER_SAMPLE_RATE} != expected {SAMPLE_RATE}"
        )

    _w.update(
        HOP_LENGTH=HOP_LENGTH,
        N_FRAMES=N_FRAMES,
        N_SAMPLES=N_SAMPLES,
        log_mel_spectrogram=log_mel_spectrogram,
        pad_or_trim=pad_or_trim,
        DecodingOptions=DecodingOptions,
        load_model=load_model,
        get_tokenizer=get_tokenizer,
        MultiHeadAttention=MultiHeadAttention,
        AudioEncoder=AudioEncoder,
    )
    _whisper_imported = True


def install_encoder_eval_patch() -> None:
    """Optionally materialize the encoder output every N transformer blocks.

    MLX builds lazy graphs. Stock mlx-whisper therefore submits the complete
    audio encoder as one graph, which can keep temporaries from several blocks
    live at once. Evaluation boundaries trade some fusion/scheduling freedom
    for a lower peak working set. The interval remains configurable for
    regression benchmarks and future model shapes.
    """
    try:
        interval = int(ENCODER_EVAL_INTERVAL)
    except ValueError as exc:
        raise ValueError(
            "SPOKE_STT_ENCODER_EVAL_INTERVAL must be a non-negative integer"
        ) from exc
    if interval < 0:
        raise ValueError(
            "SPOKE_STT_ENCODER_EVAL_INTERVAL must be a non-negative integer"
        )
    if interval == 0:
        log("sidecar: encoder evaluation boundaries disabled")
        return

    # Import lazily with the Whisper family so other engines do not pay for it.
    import mlx.nn as nn

    AudioEncoder = _w["AudioEncoder"]

    def staged_encoder_call(self, x):
        x = nn.gelu(self.conv1(x))
        x = nn.gelu(self.conv2(x))
        assert x.shape[2] == self._positional_embedding.shape[1], (
            "incorrect audio shape"
        )
        assert x.shape[1] <= self._positional_embedding.shape[0], (
            "audio is longer than the encoder context"
        )
        x = x + self._positional_embedding[: x.shape[1]]

        for block_index, block in enumerate(self.blocks, start=1):
            x, _, _ = block(x)
            if block_index % interval == 0 and block_index < len(self.blocks):
                mx.eval(x)

        return self.ln_post(x)

    AudioEncoder.__call__ = staged_encoder_call
    log(f"sidecar: encoder evaluation boundary every {interval} block(s)")


def install_encoder_attention_chunking(model) -> None:
    """Optionally tile encoder self-attention over the query sequence.

    Stock mlx-whisper materializes a [batch, heads, 1500, 1500] score tensor
    in every encoder block. Query tiling preserves exact attention semantics
    while giving MLX smaller independent score tensors to schedule and free.
    """
    try:
        chunk_size = int(ENCODER_ATTENTION_CHUNK_SIZE)
    except ValueError as exc:
        raise ValueError(
            "SPOKE_STT_ENCODER_ATTENTION_CHUNK_SIZE must be a non-negative integer"
        ) from exc
    if chunk_size < 0:
        raise ValueError(
            "SPOKE_STT_ENCODER_ATTENTION_CHUNK_SIZE must be a non-negative integer"
        )
    if chunk_size == 0:
        log("sidecar: encoder attention chunking disabled")
        return

    def chunked_qkv_attention(self, q, k, v, mask=None):
        n_batch, n_ctx, n_state = q.shape
        scale = (n_state // self.n_head) ** -0.25
        q = q.reshape(n_batch, n_ctx, self.n_head, -1).transpose(0, 2, 1, 3)
        q = q * scale
        k = k.reshape(n_batch, n_ctx, self.n_head, -1).transpose(0, 2, 3, 1)
        k = k * scale
        v = v.reshape(n_batch, n_ctx, self.n_head, -1).transpose(0, 2, 1, 3)

        outputs = []
        for start in range(0, n_ctx, chunk_size):
            end = min(start + chunk_size, n_ctx)
            scores = q[:, :, start:end] @ k
            if mask is not None:
                scores = scores + mask[start:end, :n_ctx]
            weights = mx.softmax(scores, axis=-1, precise=True)
            output = (weights @ v).transpose(0, 2, 1, 3)
            outputs.append(output.reshape(n_batch, end - start, n_state))

        return mx.concatenate(outputs, axis=1), None

    for block in model.encoder.blocks:
        block.attn.qkv_attention = types.MethodType(
            chunked_qkv_attention, block.attn
        )
    log(f"sidecar: encoder attention query chunk size {chunk_size}")


def install_fast_attention_patch(model) -> None:
    """Patch mlx_whisper's attention. Must run after _import_whisper()."""
    mode = {
        "1": "all",
        "true": "all",
        "yes": "all",
        "on": "all",
    }.get(FAST_ATTENTION_MODE, FAST_ATTENTION_MODE)

    if mode in ("", "0", "false", "no", "off"):
        log("sidecar: fast attention disabled")
        return
    if mode not in (
        "all",
        "self",
        "cross",
        "encoder",
        "decoder-cross",
        "encoder-cross",
    ):
        raise ValueError(
            "SPOKE_STT_FAST_ATTENTION must be one of: 0, 1, all, self, "
            "cross, encoder, decoder-cross, encoder-cross"
        )
    if not hasattr(mx, "fast") or not hasattr(mx.fast, "scaled_dot_product_attention"):
        log("sidecar: fast attention unavailable")
        return

    MultiHeadAttention = _w["MultiHeadAttention"]
    original_qkv_attention = MultiHeadAttention.qkv_attention

    for block in model.encoder.blocks:
        block.attn._spoke_attention_kind = "encoder"
    for block in model.decoder.blocks:
        block.attn._spoke_attention_kind = "decoder-self"
        block.cross_attn._spoke_attention_kind = "decoder-cross"

    def fast_qkv_attention(self, q, k, v, mask=None):
        attention_kind = getattr(self, "_spoke_attention_kind", "unknown")
        should_use_fast_attention = (
            mode == "all"
            or (mode == "self" and attention_kind == "decoder-self")
            or (
                mode in ("cross", "encoder-cross")
                and attention_kind in ("encoder", "decoder-cross")
            )
            or (mode == attention_kind)
        )
        if not should_use_fast_attention:
            return original_qkv_attention(self, q, k, v, mask)

        n_batch, n_ctx, n_state = q.shape
        head_dim = n_state // self.n_head
        scale = head_dim**-0.5
        q = q.reshape(*q.shape[:2], self.n_head, -1).transpose(0, 2, 1, 3)
        k = k.reshape(*k.shape[:2], self.n_head, -1).transpose(0, 2, 1, 3)
        v = v.reshape(*v.shape[:2], self.n_head, -1).transpose(0, 2, 1, 3)

        attention_mask = mask[:n_ctx, :n_ctx] if mask is not None else None
        out = mx.fast.scaled_dot_product_attention(
            q,
            k,
            v,
            scale=scale,
            mask=attention_mask,
        )
        out = out.transpose(0, 2, 1, 3).reshape(n_batch, n_ctx, n_state)
        return out, None

    MultiHeadAttention.qkv_attention = fast_qkv_attention
    log(f"sidecar: fast attention enabled ({mode})")


class WhisperEngine(Engine):
    def __init__(self, weights_dir: Path, language: str | None) -> None:
        self.weights_dir = weights_dir
        self.model_path = str(weights_dir)
        self.language = language
        self.sample_len = get_sample_len_limit()
        self.model = None
        self.load_ms: int | None = None
        self.load_peak_memory_bytes = 0

    def load(self) -> None:
        _import_whisper()
        install_encoder_eval_patch()
        validate_weights_dir(self.weights_dir, WHISPER_REQUIRED_MODEL_FILES)

        log(f"sidecar: loading {WHISPER_MODEL_DISPLAY_NAME} from {self.weights_dir}")
        reset_peak_memory()
        start = time.perf_counter()

        self.model = _w["load_model"](self.model_path, dtype=mx.float16)
        install_fast_attention_patch(self.model)
        install_encoder_attention_chunking(self.model)

        self.load_ms = round((time.perf_counter() - start) * 1000)
        self.load_peak_memory_bytes = memory_snapshot()["peak_memory_bytes"]
        log(f"sidecar: model loaded in {self.load_ms} ms")

    def warmup(self) -> None:
        if not is_enabled(WARMUP_MODE):
            log("sidecar: warmup disabled")
            return
        if self.model is None:
            raise RuntimeError("Whisper model has not been loaded.")

        try:
            log("sidecar: warming MLX decode path")
            start = time.perf_counter()
            reset_peak_memory()
            transcribe_audio(
                self.model,
                synthetic_warmup_audio(),
                self.language,
                WARMUP_SAMPLE_LEN,
            )
            clear_cache_if_enabled()
            warmup_ms = round((time.perf_counter() - start) * 1000)
            log(f"sidecar: warmup complete in {warmup_ms} ms")
        except Exception as exc:
            log(f"sidecar: warmup failed; continuing cold: {exc}")

    def transcribe(self, audio: np.ndarray, prompt: str | None = None) -> None:
        request_start = time.perf_counter()
        stats = audio_stats(audio)
        audio_analysis_ms = round((time.perf_counter() - request_start) * 1000)
        log(
            "sidecar: received "
            f"{len(audio)} samples ({stats['audio_duration_ms']} ms)"
        )

        if stats["is_no_speech"]:
            metrics = self._metrics(
                stats=stats,
                inference_ms=0,
                transcript="",
                language=None,
                segment_count=0,
                memory=memory_snapshot(),
                sample_len=self.sample_len,
                timings={"audio_analysis_ms": audio_analysis_ms},
            )
            emit({"type": "done", "transcript": "", "metrics": metrics})
            log("sidecar: skipped non-speech audio")
            return

        reset_peak_memory()
        start = time.perf_counter()

        if self.model is None:
            raise RuntimeError("Whisper model has not been loaded.")

        result = transcribe_audio(
            self.model, audio, self.language, self.sample_len, prompt=prompt
        )
        inference_ms = round((time.perf_counter() - start) * 1000)
        memory = memory_snapshot()
        clear_cache_if_enabled()

        transcript = str(result.get("text", "")).strip()
        segments = result.get("segments") or []
        metrics = self._metrics(
            stats=stats,
            inference_ms=inference_ms,
            transcript=transcript,
            language=result.get("language"),
            segment_count=len(segments),
            memory=memory,
            sample_len=result.get("sample_len"),
            timings={
                "audio_analysis_ms": audio_analysis_ms,
                **dict(result.get("timings") or {}),
            },
        )

        emit({"type": "done", "transcript": transcript, "metrics": metrics})
        log(
            "sidecar: done - "
            f"{metrics['word_count']} words, "
            f"{metrics['inference_ms']} ms inference, "
            f"{metrics['audio_duration_ms']} ms audio"
        )

    def _metrics(
        self,
        *,
        stats: dict[str, float | int | bool],
        inference_ms: int,
        transcript: str,
        language: str | None,
        segment_count: int,
        memory: dict[str, int],
        sample_len: int | None = None,
        timings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return build_metrics(
            model_id=WHISPER_MODEL_ID,
            stats=stats,
            inference_ms=inference_ms,
            transcript=transcript,
            language=language,
            segment_count=segment_count,
            memory=memory,
            model_load_ms=self.load_ms or 0,
            model_load_peak_memory_bytes=self.load_peak_memory_bytes,
            sample_len=sample_len,
            timings=timings,
        )


def transcribe_audio(
    model,
    audio: np.ndarray,
    language: str | None,
    sample_len: int | None,
    prompt: str | None = None,
) -> dict[str, Any]:
    log_mel_spectrogram = _w["log_mel_spectrogram"]
    pad_or_trim = _w["pad_or_trim"]
    DecodingOptions = _w["DecodingOptions"]
    get_tokenizer = _w["get_tokenizer"]
    N_FRAMES = _w["N_FRAMES"]
    N_SAMPLES = _w["N_SAMPLES"]
    HOP_LENGTH = _w["HOP_LENGTH"]
    dynamic_padding_frames = get_dynamic_padding_frames()

    dtype = mx.float16
    profile_enabled = is_enabled(PROFILE_MODE)
    timings: dict[str, int | bool] = {"profile_enabled": profile_enabled}

    start = time.perf_counter()
    mel = log_mel_spectrogram(audio, n_mels=model.dims.n_mels, padding=N_SAMPLES)
    if profile_enabled:
        mx.eval(mel)
    timings["mel_ms"] = round((time.perf_counter() - start) * 1000)
    content_frames = mel.shape[-2] - N_FRAMES

    start = time.perf_counter()
    detected_language, detected_audio_features = detect_language(
        model,
        mel,
        dtype,
        language,
    )
    timings["language_detection_ms"] = round((time.perf_counter() - start) * 1000)

    start = time.perf_counter()
    tokenizer = get_tokenizer(
        model.is_multilingual,
        num_languages=model.num_languages,
        language=detected_language,
        task="transcribe",
    )
    timings["postprocess_ms"] = round((time.perf_counter() - start) * 1000)

    seek = 0
    segment_id = 0
    all_text: list[str] = []
    segments: list[dict[str, Any]] = []

    while seek < content_frames:
        segment_size = min(N_FRAMES, content_frames - seek)
        if segment_size <= 0:
            break

        time_offset = float(seek * HOP_LENGTH / SAMPLE_RATE)
        duration = float(segment_size * HOP_LENGTH / SAMPLE_RATE)
        mel_segment = mel[seek : seek + segment_size]
        encoder_frames = N_FRAMES
        if dynamic_padding_frames > 0 and segment_size < N_FRAMES:
            # Whisper normally encodes 30 seconds even for a short command.
            # Retain a generous silence tail for model behavior while avoiding
            # transformer work on the rest of the synthetic padding.
            encoder_frames = min(N_FRAMES, segment_size + dynamic_padding_frames)
        mel_segment = pad_or_trim(mel_segment, encoder_frames, axis=-2).astype(dtype)
        audio_features = detected_audio_features if seek == 0 else None

        result = decode_segment(
            model,
            mel_segment,
            DecodingOptions(
                language=detected_language,
                task="transcribe",
                temperature=0.0,
                sample_len=sample_len,
                fp16=True,
                without_timestamps=True,
                # Vocabulary/decoding hint (proper nouns, product names, etc).
                # mlx_whisper's DecodingTask treats this like Whisper's
                # initial_prompt: it seeds the decode context and is itself
                # truncated to the model's context budget, so no additional
                # bounding is needed here beyond what buildSTTPrompt already
                # caps on the caller side.
                prompt=prompt,
            ),
            timings=timings,
            profile_enabled=profile_enabled,
            audio_features=audio_features,
        )

        start = time.perf_counter()
        if should_skip_decoded_segment(result):
            seek += segment_size
            timings["postprocess_ms"] += round((time.perf_counter() - start) * 1000)
            continue

        text_tokens = [token for token in result.tokens if token < tokenizer.eot]
        text = tokenizer.decode(text_tokens).strip()
        if text:
            all_text.append(text)
            segments.append(
                {
                    "id": segment_id,
                    "seek": seek,
                    "start": time_offset,
                    "end": time_offset + duration,
                    "text": text,
                    "avg_logprob": result.avg_logprob,
                    "compression_ratio": result.compression_ratio,
                    "no_speech_prob": result.no_speech_prob,
                }
            )
            segment_id += 1

        timings["postprocess_ms"] += round((time.perf_counter() - start) * 1000)
        seek += segment_size

    return {
        "text": " ".join(all_text),
        "segments": segments,
        "language": detected_language,
        "sample_len": sample_len,
        "timings": timings,
    }


def decode_segment(
    model,
    mel_segment: mx.array,
    options,
    *,
    timings: dict[str, int | bool],
    profile_enabled: bool,
    audio_features: mx.array | None = None,
):
    if audio_features is not None:
        if not profile_enabled:
            return model.decode(audio_features, options)

        start = time.perf_counter()
        result = model.decode(audio_features, options)
        timings["decoder_ms"] = int(timings.get("decoder_ms", 0)) + round(
            (time.perf_counter() - start) * 1000
        )
        return result

    if not profile_enabled:
        return model.decode(mel_segment, options)

    start = time.perf_counter()
    audio_features = model.encoder(mel_segment[None])[0]
    mx.eval(audio_features)
    timings["encoder_ms"] = int(timings.get("encoder_ms", 0)) + round(
        (time.perf_counter() - start) * 1000
    )

    start = time.perf_counter()
    result = model.decode(audio_features, options)
    timings["decoder_ms"] = int(timings.get("decoder_ms", 0)) + round(
        (time.perf_counter() - start) * 1000
    )
    return result


def detect_language(
    model,
    mel,
    dtype: mx.Dtype,
    language: str | None,
) -> tuple[str, mx.array | None]:
    pad_or_trim = _w["pad_or_trim"]
    N_FRAMES = _w["N_FRAMES"]
    if language is not None:
        return language, None
    if not model.is_multilingual:
        return "en", None

    mel_segment = pad_or_trim(mel, N_FRAMES, axis=-2).astype(dtype)
    audio_features = model.encoder(mel_segment[None])
    _, probabilities = model.detect_language(audio_features)
    return max(probabilities[0], key=probabilities[0].get), audio_features[0]


def should_skip_decoded_segment(result) -> bool:
    if result.no_speech_prob <= NO_SPEECH_THRESHOLD:
        return False
    return result.avg_logprob <= LOW_LOGPROB_THRESHOLD


# ---------------------------------------------------------------------------
# Cohere engine (mlx-speech). Heavy import happens lazily in load().
# ---------------------------------------------------------------------------


_cohere_model_cls: Any = None


def _import_cohere() -> None:
    """Lazily import mlx_speech. Only the cohere path triggers this."""
    global _cohere_model_cls
    if _cohere_model_cls is not None:
        return
    from mlx_speech.generation import CohereAsrModel

    _cohere_model_cls = CohereAsrModel


class CohereEngine(Engine):
    def __init__(self, weights_dir: Path, language: str | None) -> None:
        self.weights_dir = weights_dir
        self.model_path = str(weights_dir)
        # Cohere has no auto language detection here; treat "auto" (None) as "en".
        self.language = language or "en"
        self.model = None
        self.load_ms: int | None = None
        self.load_peak_memory_bytes = 0

    def load(self) -> None:
        _import_cohere()
        validate_weights_dir(self.weights_dir, COHERE_REQUIRED_MODEL_FILES)

        log(f"sidecar: loading {COHERE_MODEL_DISPLAY_NAME} from {self.weights_dir}")
        reset_peak_memory()
        start = time.perf_counter()

        self.model = _cohere_model_cls.from_path(self.model_path)

        self.load_ms = round((time.perf_counter() - start) * 1000)
        self.load_peak_memory_bytes = memory_snapshot()["peak_memory_bytes"]
        log(f"sidecar: model loaded in {self.load_ms} ms")

    def warmup(self) -> None:
        if not is_enabled(WARMUP_MODE):
            log("sidecar: warmup disabled")
            return
        if self.model is None:
            raise RuntimeError("Cohere model has not been loaded.")

        try:
            log("sidecar: warming MLX decode path")
            start = time.perf_counter()
            reset_peak_memory()
            self.model.transcribe(
                synthetic_warmup_audio(),
                sample_rate=SAMPLE_RATE,
                language=self.language,
            )
            clear_cache_if_enabled()
            warmup_ms = round((time.perf_counter() - start) * 1000)
            log(f"sidecar: warmup complete in {warmup_ms} ms")
        except Exception as exc:
            log(f"sidecar: warmup failed; continuing cold: {exc}")

    def transcribe(self, audio: np.ndarray, prompt: str | None = None) -> None:
        # mlx-speech's CohereAsrModel.transcribe() (see
        # mlx_speech.generation.cohere_asr.CohereAsrModel._decode) builds the
        # decoder's prompt purely from fixed language/punctuation/itn tokens
        # via tokenizer.get_decoder_prompt_ids(); there is no vocabulary,
        # hotword, or free-text prompt/context parameter to hook into. The
        # request-level prompt is accepted for API symmetry with WhisperEngine
        # but intentionally ignored here.
        del prompt

        request_start = time.perf_counter()
        stats = audio_stats(audio)
        audio_analysis_ms = round((time.perf_counter() - request_start) * 1000)
        log(
            "sidecar: received "
            f"{len(audio)} samples ({stats['audio_duration_ms']} ms)"
        )

        if stats["is_no_speech"]:
            metrics = self._metrics(
                stats=stats,
                inference_ms=0,
                transcript="",
                language=None,
                segment_count=0,
                memory=memory_snapshot(),
                timings={"audio_analysis_ms": audio_analysis_ms},
            )
            emit({"type": "done", "transcript": "", "metrics": metrics})
            log("sidecar: skipped non-speech audio")
            return

        reset_peak_memory()
        start = time.perf_counter()

        if self.model is None:
            raise RuntimeError("Cohere model has not been loaded.")

        result = self.model.transcribe(
            np.asarray(audio, dtype=np.float32),
            sample_rate=SAMPLE_RATE,
            language=self.language,
        )
        inference_ms = round((time.perf_counter() - start) * 1000)
        memory = memory_snapshot()
        clear_cache_if_enabled()

        transcript = str(getattr(result, "text", "") or "").strip()
        language = getattr(result, "language", None) or self.language
        metrics = self._metrics(
            stats=stats,
            inference_ms=inference_ms,
            transcript=transcript,
            language=language,
            segment_count=1 if transcript else 0,
            memory=memory,
            timings={"audio_analysis_ms": audio_analysis_ms},
        )

        emit({"type": "done", "transcript": transcript, "metrics": metrics})
        log(
            "sidecar: done - "
            f"{metrics['word_count']} words, "
            f"{metrics['inference_ms']} ms inference, "
            f"{metrics['audio_duration_ms']} ms audio"
        )

    def _metrics(
        self,
        *,
        stats: dict[str, float | int | bool],
        inference_ms: int,
        transcript: str,
        language: str | None,
        segment_count: int,
        memory: dict[str, int],
        timings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return build_metrics(
            model_id=COHERE_MODEL_ID,
            stats=stats,
            inference_ms=inference_ms,
            transcript=transcript,
            language=language,
            segment_count=segment_count,
            memory=memory,
            model_load_ms=self.load_ms or 0,
            model_load_peak_memory_bytes=self.load_peak_memory_bytes,
            sample_len=None,
            timings=timings,
        )


# ---------------------------------------------------------------------------
# Parakeet engine (parakeet-mlx). Heavy imports happen lazily in load().
# ---------------------------------------------------------------------------


# Module-level holders for the parakeet helpers, populated by _import_parakeet().
_parakeet_imported = False
_p: dict[str, Any] = {}

# librosa.filters.mel arguments parakeet-mlx derives from this model's
# preprocessor config (sr, n_fft=512, n_mels=features=128, fmax=sr/2). The
# stub below asserts against these so a config change can never silently pair
# with a stale filterbank.
PARAKEET_MEL_ARGS = {
    "sr": SAMPLE_RATE,
    "n_fft": 512,
    "n_mels": 128,
    "fmin": 0.0,
    "fmax": SAMPLE_RATE / 2,
    "norm": "slaney",
}


def _install_librosa_stub(mel_filters_path: Path) -> None:
    """Install a minimal librosa stand-in before parakeet_mlx is imported.

    parakeet-mlx imports librosa solely for filters.mel(), a deterministic
    filterbank matrix, but calling it drags scipy and numba in at runtime,
    which the PyInstaller bundle excludes. The exact matrix ships alongside
    the weights as mel_filters.npy instead. Installed unconditionally (even
    when real librosa is importable) so dev and the bundle run the same path.
    """

    def stub_mel(
        *,
        sr,
        n_fft,
        n_mels=128,
        fmin=0.0,
        fmax=None,
        htk=False,
        norm="slaney",
        dtype=None,
    ):
        del dtype
        got = {
            "sr": sr,
            "n_fft": n_fft,
            "n_mels": n_mels,
            "fmin": float(fmin),
            "fmax": float(fmax) if fmax is not None else None,
            "norm": norm,
        }
        if htk or got != PARAKEET_MEL_ARGS:
            raise ValueError(
                f"mel filterbank args {got} (htk={htk}) do not match the "
                f"precomputed {mel_filters_path.name} ({PARAKEET_MEL_ARGS}); "
                "the model's preprocessor config has changed."
            )
        return np.load(mel_filters_path)

    librosa_stub = types.ModuleType("librosa")
    filters_stub = types.ModuleType("librosa.filters")
    filters_stub.mel = stub_mel
    librosa_stub.filters = filters_stub
    sys.modules["librosa"] = librosa_stub
    sys.modules["librosa.filters"] = filters_stub


def _import_parakeet(mel_filters_path: Path) -> None:
    """Lazily import parakeet_mlx. Only the parakeet path triggers this."""
    global _parakeet_imported
    if _parakeet_imported:
        return

    _install_librosa_stub(mel_filters_path)

    import mlx.nn as nn
    import mlx.utils
    from parakeet_mlx import tokenizer as parakeet_tokenizer
    from parakeet_mlx.alignment import AlignedToken
    from parakeet_mlx.audio import get_logmel
    from parakeet_mlx.conformer import (
        Conformer,
        DwStridingSubsampling,
    )
    from parakeet_mlx.attention import RelPositionMultiHeadAttention
    from parakeet_mlx.utils import from_config

    _p.update(
        nn=nn,
        tree_flatten=mlx.utils.tree_flatten,
        tree_unflatten=mlx.utils.tree_unflatten,
        get_logmel=get_logmel,
        parakeet_tokenizer=parakeet_tokenizer,
        AlignedToken=AlignedToken,
        from_config=from_config,
        Conformer=Conformer,
        DwStridingSubsampling=DwStridingSubsampling,
        RelPositionMultiHeadAttention=RelPositionMultiHeadAttention,
    )
    _parakeet_imported = True


def install_parakeet_encoder_eval_patch() -> None:
    """Materialize the Parakeet encoder every N Conformer blocks."""
    try:
        interval = int(PARAKEET_ENCODER_EVAL_INTERVAL)
    except ValueError as exc:
        raise ValueError(
            "SPOKE_STT_PARAKEET_ENCODER_EVAL_INTERVAL must be non-negative"
        ) from exc
    if interval < 0:
        raise ValueError(
            "SPOKE_STT_PARAKEET_ENCODER_EVAL_INTERVAL must be non-negative"
        )
    if interval == 0:
        log("sidecar: Parakeet encoder evaluation boundaries disabled")
        return

    Conformer = _p["Conformer"]
    DwStridingSubsampling = _p["DwStridingSubsampling"]
    nn = _p["nn"]

    def staged_conformer_call(self, x, lengths=None, cache=None):
        if lengths is None:
            lengths = mx.full((x.shape[0],), x.shape[-2], dtype=mx.int64)

        if isinstance(self.pre_encode, DwStridingSubsampling):
            x, out_lengths = self.pre_encode(x, lengths)
        elif isinstance(self.pre_encode, nn.Linear):
            x = self.pre_encode(x)
            out_lengths = lengths
        else:
            raise NotImplementedError("Non-implemented pre-encoding layer type")

        if cache is None:
            cache = [None] * len(self.layers)

        pos_emb = None
        if self.pos_enc is not None:
            x, pos_emb = self.pos_enc(
                x,
                offset=cache[0].offset if cache[0] is not None else 0,
            )

        for layer_index, (layer, layer_cache) in enumerate(
            zip(self.layers, cache), start=1
        ):
            x = layer(x, pos_emb=pos_emb, cache=layer_cache)
            if (
                interval > 0
                and layer_index % interval == 0
                and layer_index < len(self.layers)
            ):
                mx.eval(x)

        return x, out_lengths

    Conformer.__call__ = staged_conformer_call
    log(f"sidecar: Parakeet encoder boundary every {interval} block(s)")


def install_parakeet_fused_qkv_patch(model) -> None:
    """Replace Parakeet's three quantized Q/K/V projections with one QKV."""
    if not is_enabled(PARAKEET_FUSED_QKV_MODE):
        log("sidecar: Parakeet fused QKV disabled")
        return

    nn = _p["nn"]
    attention_type = _p["RelPositionMultiHeadAttention"]

    def fused_attention_call(
        self,
        q,
        k,
        v,
        pos_emb=None,
        mask=None,
        cache=None,
    ):
        if pos_emb is None:
            raise ValueError("pos_emb is necessary")
        if q is not k or q is not v:
            raise ValueError("Fused Parakeet QKV requires self-attention inputs")

        q, k, v = mx.split(self.linear_qkv(q), 3, axis=-1)
        p = self.linear_pos(pos_emb)

        batch, q_seq, _ = q.shape
        _, k_seq, _ = k.shape
        p_batch, pos_len, _ = p.shape

        if p_batch == 1 and batch > 1:
            p = mx.broadcast_to(p, (batch, pos_len, p.shape[-1]))
        elif p_batch != batch:
            raise ValueError(
                f"pos_emb batch ({p_batch}) must be 1 or match query batch ({batch})"
            )

        q = q.reshape(batch, q_seq, self.n_head, self.head_dim)
        q_u = (q + self.pos_bias_u).transpose(0, 2, 1, 3)
        q_v = (q + self.pos_bias_v).transpose(0, 2, 1, 3)
        k = k.reshape(batch, k_seq, self.n_head, self.head_dim).transpose(0, 2, 1, 3)
        v = v.reshape(batch, k_seq, self.n_head, self.head_dim).transpose(0, 2, 1, 3)
        p = p.reshape(batch, pos_len, self.n_head, self.head_dim).transpose(0, 2, 1, 3)

        if cache is not None:
            k, v = cache.update_and_fetch_kv(k, v)

        matrix_bd = mx.matmul(q_v, p.swapaxes(-2, -1))
        matrix_bd = self.rel_shift(matrix_bd)
        matrix_bd = matrix_bd[:, :, :, : k.shape[-2]] * self.scale

        if mask is not None:
            mask = mx.expand_dims(mask, 0)
            matrix_bd[mask] = -mx.inf

        output = mx.fast.scaled_dot_product_attention(
            q_u, k, v, scale=self.scale, mask=matrix_bd
        )
        output = output.transpose(0, 2, 1, 3).reshape(batch, q_seq, -1)
        return self.linear_out(output)

    fused_count = 0
    for layer in model.encoder.layers:
        attention = layer.self_attn
        if type(attention) is not attention_type:
            raise TypeError(
                "Parakeet fused QKV only supports relative-position self-attention"
            )

        projections = (
            attention.linear_q,
            attention.linear_k,
            attention.linear_v,
        )
        first = projections[0]
        if not all(
            type(projection) is nn.QuantizedLinear for projection in projections
        ):
            raise TypeError("Parakeet fused QKV requires quantized linear projections")
        if any("bias" in projection for projection in projections):
            raise ValueError("Parakeet fused QKV does not support projection biases")
        if not all(
            (projection.group_size, projection.bits, projection.mode)
            == (first.group_size, first.bits, first.mode)
            for projection in projections
        ):
            raise ValueError("Parakeet QKV projection quantization must match")

        input_dims = first.scales.shape[-1] * first.group_size
        output_dims = sum(projection.weight.shape[0] for projection in projections)
        fused = nn.QuantizedLinear(
            input_dims,
            output_dims,
            bias=False,
            group_size=first.group_size,
            bits=first.bits,
            mode=first.mode,
        )
        fused.weight = mx.concatenate(
            [projection.weight for projection in projections], axis=0
        )
        fused.scales = mx.concatenate(
            [projection.scales for projection in projections], axis=0
        )
        fused.biases = mx.concatenate(
            [projection.biases for projection in projections], axis=0
        )
        mx.eval(fused.weight, fused.scales, fused.biases)

        attention.linear_qkv = fused
        del attention.linear_q
        del attention.linear_k
        del attention.linear_v
        fused_count += 1

    attention_type.__call__ = fused_attention_call
    mx.clear_cache()
    log(f"sidecar: fused Parakeet QKV projections in {fused_count} blocks")


def install_parakeet_fast_decode_patch(model) -> None:
    """Remove unused confidence work and synchronize TDT decisions together."""
    if not is_enabled(PARAKEET_FAST_DECODE_MODE):
        log("sidecar: fast Parakeet decoder disabled")
        return

    aligned_token = _p["AlignedToken"]
    tokenizer = _p["parakeet_tokenizer"]

    def decode_greedy(
        self,
        features,
        lengths=None,
        last_token=None,
        hidden_state=None,
        *,
        config=None,
    ):
        del config
        batch_size, sequence_length, *_ = features.shape
        hidden_state = hidden_state or [None] * batch_size
        last_token = last_token or [None] * batch_size
        if lengths is None:
            lengths = mx.array([sequence_length] * batch_size)

        blank_token = len(self.vocabulary)
        results = []
        for batch in range(batch_size):
            hypothesis = []
            feature = features[batch : batch + 1]
            length = int(lengths[batch])
            step = 0
            new_symbols = 0

            while step < length:
                decoder_out, (hidden, cell) = self.decoder(
                    mx.array([[last_token[batch]]])
                    if last_token[batch] is not None
                    else None,
                    hidden_state[batch],
                )
                decoder_out = decoder_out.astype(feature.dtype)
                decoder_hidden = (
                    hidden.astype(feature.dtype),
                    cell.astype(feature.dtype),
                )
                joint_out = self.joint(feature[:, step : step + 1], decoder_out)

                pred_token = mx.argmax(joint_out[0, 0, :, : blank_token + 1])
                decision = mx.argmax(joint_out[0, 0, :, blank_token + 1 :])
                mx.eval(pred_token, decision)
                pred_token = int(pred_token)
                decision = int(decision)

                if pred_token != blank_token:
                    hypothesis.append(
                        aligned_token(
                            pred_token,
                            start=step * self.time_ratio,
                            duration=self.durations[decision] * self.time_ratio,
                            text=tokenizer.decode([pred_token], self.vocabulary),
                        )
                    )
                    last_token[batch] = pred_token
                    hidden_state[batch] = decoder_hidden

                duration = self.durations[decision]
                step += duration
                new_symbols += 1
                if duration != 0:
                    new_symbols = 0
                elif self.max_symbols is not None and self.max_symbols <= new_symbols:
                    step += 1
                    new_symbols = 0

            results.append(hypothesis)

        return results, hidden_state

    model.decode_greedy = types.MethodType(decode_greedy, model)
    log("sidecar: reduced Parakeet greedy decoder synchronization")


class ParakeetEngine(Engine):
    def __init__(self, weights_dir: Path, language: str | None) -> None:
        self.weights_dir = weights_dir
        # Parakeet TDT v2 is English-only; any requested language is ignored.
        del language
        self.language = "en"
        self.model = None
        self.load_ms: int | None = None
        self.load_peak_memory_bytes = 0

    def load(self) -> None:
        _import_parakeet(self.weights_dir / "mel_filters.npy")
        install_parakeet_encoder_eval_patch()
        validate_weights_dir(self.weights_dir, PARAKEET_REQUIRED_MODEL_FILES)

        log(f"sidecar: loading {PARAKEET_MODEL_DISPLAY_NAME} from {self.weights_dir}")
        reset_peak_memory()
        start = time.perf_counter()

        with open(self.weights_dir / "config.json", encoding="utf-8") as f:
            config = json.load(f)
        model = _p["from_config"](config)
        _p["nn"].quantize(
            model,
            group_size=PARAKEET_QUANT_GROUP_SIZE,
            bits=PARAKEET_QUANT_BITS,
        )
        model.load_weights(str(self.weights_dir / "model.safetensors"))
        # Cast the layers nn.quantize skips (Conv1d, BatchNorm, the TDT
        # prediction LSTM) from fp32 init to bf16, mirroring from_pretrained's
        # post-load dtype cast. Packed quantized weights load as-is.
        model.update(
            _p["tree_unflatten"](
                [
                    (k, v.astype(mx.bfloat16) if v.dtype == mx.float32 else v)
                    for k, v in _p["tree_flatten"](model.parameters())
                ]
            )
        )
        mx.eval(model.parameters())
        install_parakeet_fused_qkv_patch(model)
        install_parakeet_fast_decode_patch(model)

        if model.preprocessor_config.sample_rate != SAMPLE_RATE:
            raise RuntimeError(
                f"Parakeet sample rate {model.preprocessor_config.sample_rate} "
                f"!= expected {SAMPLE_RATE}"
            )

        self.model = model
        self.load_ms = round((time.perf_counter() - start) * 1000)
        self.load_peak_memory_bytes = memory_snapshot()["peak_memory_bytes"]
        log(f"sidecar: model loaded in {self.load_ms} ms")

    def warmup(self) -> None:
        if not is_enabled(WARMUP_MODE):
            log("sidecar: warmup disabled")
            return
        if self.model is None:
            raise RuntimeError("Parakeet model has not been loaded.")

        try:
            log("sidecar: warming MLX decode path")
            start = time.perf_counter()
            reset_peak_memory()
            self._generate(synthetic_warmup_audio())
            clear_cache_if_enabled()
            warmup_ms = round((time.perf_counter() - start) * 1000)
            log(f"sidecar: warmup complete in {warmup_ms} ms")
        except Exception as exc:
            log(f"sidecar: warmup failed; continuing cold: {exc}")

    def _generate(self, audio: np.ndarray) -> str:
        mel = _p["get_logmel"](
            mx.array(np.asarray(audio, dtype=np.float32)),
            self.model.preprocessor_config,
        )
        result = self.model.generate(mel)[0]
        return "".join(token.text for token in result.tokens).strip()

    def transcribe(self, audio: np.ndarray, prompt: str | None = None) -> None:
        # Parakeet's TDT transducer decodes audio frames directly; there is no
        # text-conditioning input (no initial_prompt equivalent) to seed with a
        # vocabulary hint. The request-level prompt is accepted for API
        # symmetry with WhisperEngine but intentionally ignored here.
        del prompt

        request_start = time.perf_counter()
        stats = audio_stats(audio)
        audio_analysis_ms = round((time.perf_counter() - request_start) * 1000)
        log(
            "sidecar: received "
            f"{len(audio)} samples ({stats['audio_duration_ms']} ms)"
        )

        if stats["is_no_speech"]:
            metrics = self._metrics(
                stats=stats,
                inference_ms=0,
                transcript="",
                language=None,
                segment_count=0,
                memory=memory_snapshot(),
                timings={"audio_analysis_ms": audio_analysis_ms},
            )
            emit({"type": "done", "transcript": "", "metrics": metrics})
            log("sidecar: skipped non-speech audio")
            return

        reset_peak_memory()
        start = time.perf_counter()

        if self.model is None:
            raise RuntimeError("Parakeet model has not been loaded.")

        transcript = self._generate(audio)
        inference_ms = round((time.perf_counter() - start) * 1000)
        memory = memory_snapshot()
        clear_cache_if_enabled()

        metrics = self._metrics(
            stats=stats,
            inference_ms=inference_ms,
            transcript=transcript,
            language=self.language,
            segment_count=1 if transcript else 0,
            memory=memory,
            timings={"audio_analysis_ms": audio_analysis_ms},
        )

        emit({"type": "done", "transcript": transcript, "metrics": metrics})
        log(
            "sidecar: done - "
            f"{metrics['word_count']} words, "
            f"{metrics['inference_ms']} ms inference, "
            f"{metrics['audio_duration_ms']} ms audio"
        )

    def _metrics(
        self,
        *,
        stats: dict[str, float | int | bool],
        inference_ms: int,
        transcript: str,
        language: str | None,
        segment_count: int,
        memory: dict[str, int],
        timings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return build_metrics(
            model_id=PARAKEET_MODEL_ID,
            stats=stats,
            inference_ms=inference_ms,
            transcript=transcript,
            language=language,
            segment_count=segment_count,
            memory=memory,
            model_load_ms=self.load_ms or 0,
            model_load_peak_memory_bytes=self.load_peak_memory_bytes,
            sample_len=None,
            timings=timings,
        )


# ---------------------------------------------------------------------------
# Nemotron streaming engine (mlx-audio). Imports stay lazy so other engines do
# not pay its import or packaging cost at startup.
# ---------------------------------------------------------------------------


class NemotronEngine(Engine):
    def __init__(self, weights_dir: Path, language: str | None) -> None:
        self.weights_dir = weights_dir
        self.language = language or "en-US"
        self.model = None
        self.load_ms: int | None = None
        self.load_peak_memory_bytes = 0

    @property
    def supports_streaming(self) -> bool:
        return True

    def load(self) -> None:
        validate_weights_dir(self.weights_dir, NEMOTRON_REQUIRED_MODEL_FILES)
        from mlx_audio.stt import load

        log(f"sidecar: loading {NEMOTRON_MODEL_DISPLAY_NAME} from {self.weights_dir}")
        reset_peak_memory()
        start = time.perf_counter()
        self.model = load(str(self.weights_dir), lazy=False)
        sample_rate = self.model.preprocessor_config.sample_rate
        if sample_rate != SAMPLE_RATE:
            raise RuntimeError(
                f"Nemotron sample rate {sample_rate} != expected {SAMPLE_RATE}"
            )
        self.load_ms = round((time.perf_counter() - start) * 1000)
        self.load_peak_memory_bytes = memory_snapshot()["peak_memory_bytes"]
        log(f"sidecar: model loaded in {self.load_ms} ms")

    def warmup(self) -> None:
        if not is_enabled(WARMUP_MODE):
            log("sidecar: warmup disabled")
            return
        if self.model is None:
            raise RuntimeError("Nemotron model has not been loaded.")
        try:
            log("sidecar: warming Nemotron streaming decode path")
            start = time.perf_counter()
            list(
                self.model.stream_generate(
                    mx.zeros((SAMPLE_RATE,), dtype=mx.float32),
                    language=self.language,
                    chunk_duration=0.32,
                    att_context_size=[56, 3],
                )
            )
            clear_cache_if_enabled()
            log(
                "sidecar: warmup complete in "
                f"{round((time.perf_counter() - start) * 1000)} ms"
            )
        except Exception as exc:
            log(f"sidecar: warmup failed; continuing cold: {exc}")

    def transcribe(self, audio: np.ndarray, prompt: str | None = None) -> None:
        del prompt
        if self.model is None:
            raise RuntimeError("Nemotron model has not been loaded.")
        start = time.perf_counter()
        result = self.model.generate(
            mx.array(audio),
            language=self.language,
            chunk_duration=0.32,
            att_context_size=[56, 3],
        )
        transcript = result.text.strip()
        inference_ms = round((time.perf_counter() - start) * 1000)
        emit(
            {
                "type": "done",
                "transcript": transcript,
                "metrics": {
                    "model_id": NEMOTRON_MODEL_ID,
                    "model_load_ms": self.load_ms or 0,
                    "audio_duration_ms": round(len(audio) / SAMPLE_RATE * 1000),
                    "inference_ms": inference_ms,
                    "ttft_ms": None,
                    "word_count": len(transcript.split()),
                    **memory_snapshot(),
                },
            }
        )

    def stream(self, read_pcm_frame) -> None:
        if self.model is None:
            raise RuntimeError("Nemotron model has not been loaded.")
        from nemotron_streaming import stream_results

        started = time.perf_counter()
        first_text_at: float | None = None
        transcript = ""
        total_audio_bytes = 0
        input_wait_seconds = 0.0

        def tracked_read() -> bytes | None:
            nonlocal input_wait_seconds, total_audio_bytes
            wait_started = time.perf_counter()
            frame = read_pcm_frame()
            input_wait_seconds += time.perf_counter() - wait_started
            if frame is not None:
                total_audio_bytes += len(frame)
            return frame

        reset_peak_memory()
        for result in stream_results(
            self.model,
            tracked_read,
            language=self.language,
        ):
            text = result.text.strip()
            if text == transcript:
                continue
            transcript = text
            if transcript and first_text_at is None:
                first_text_at = time.perf_counter()
            emit({"type": "partial", "text": transcript})

        finished = time.perf_counter()
        elapsed_ms = round((finished - started) * 1000)
        inference_ms = round(
            max(0.0, finished - started - input_wait_seconds) * 1000
        )
        emit(
            {
                "type": "done",
                "transcript": transcript,
                "metrics": {
                    "model_id": NEMOTRON_MODEL_ID,
                    "model_load_ms": self.load_ms or 0,
                    "audio_duration_ms": round(
                        total_audio_bytes / 2 / SAMPLE_RATE * 1000
                    ),
                    "inference_ms": inference_ms,
                    "stream_elapsed_ms": elapsed_ms,
                    "ttft_ms": (
                        round((first_text_at - started) * 1000)
                        if first_text_at is not None
                        else None
                    ),
                    "word_count": len(transcript.split()),
                    **memory_snapshot(),
                },
            }
        )
        clear_cache_if_enabled()


# ---------------------------------------------------------------------------
# IPC / daemon driver (engine-agnostic).
# ---------------------------------------------------------------------------


def build_engine(family: str, weights_dir: Path, language: str | None) -> Engine:
    if family == "whisper":
        return WhisperEngine(weights_dir=weights_dir, language=language)
    if family == "cohere":
        return CohereEngine(weights_dir=weights_dir, language=language)
    if family == "parakeet":
        return ParakeetEngine(weights_dir=weights_dir, language=language)
    if family == "nemotron":
        return NemotronEngine(weights_dir=weights_dir, language=language)
    raise ValueError(f"Unknown engine family: {family}")


def read_length_prefixed(stream) -> bytes | None:
    """Read one 4-byte-length-prefixed frame. Returns None for a zero-length
    frame (used as the shutdown signal)."""
    length_bytes = read_exact(stream, 4)
    length = struct.unpack("<I", length_bytes)[0]
    if length == 0:
        return None
    return read_exact(stream, length)


# Parakeet's full relative-attention implementation is intentionally never
# given arbitrarily long audio. This mirrors the main-process guard so a bad or
# old renderer cannot feed one huge request directly to the model.
MAX_AUDIO_REQUEST_BYTES = 30 * 16_000 * 2
MAX_STREAM_FRAME_BYTES = 1 * 16_000 * 2
MAX_STREAM_AUDIO_BYTES = 5 * 60 * 16_000 * 2


def read_stream_audio_frame(stream, total_bytes: int) -> bytes | None:
    """Read one live PCM frame. A zero-length frame finalizes the session."""
    length_bytes = read_exact(stream, 4)
    length = struct.unpack("<I", length_bytes)[0]
    if length == 0:
        return None
    if length % 2 != 0:
        raise ValueError("Streaming PCM16 frame has an odd byte length.")
    if length > MAX_STREAM_FRAME_BYTES:
        raise ValueError("Streaming PCM16 frame exceeds the one-second limit.")
    if total_bytes + length > MAX_STREAM_AUDIO_BYTES:
        raise ValueError("Streaming dictation exceeds the five-minute limit.")
    return read_exact(stream, length)


def parse_request_metadata(raw: bytes) -> dict[str, Any]:
    """Best-effort parse of the JSON metadata frame. Malformed or non-object
    metadata is treated as empty rather than failing the request."""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        log(f"sidecar: failed to parse request metadata, ignoring: {exc}")
        return {}
    return parsed if isinstance(parsed, dict) else {}


def daemon_mode(engine: Engine) -> int:
    try:
        engine.load()
        engine.warmup()
    except Exception as exc:
        log_exception(exc, include_traceback=False)
        emit_error(str(exc), "model_load_failed")
        return 1

    emit({"type": "ready"})
    log("sidecar: daemon ready")

    while True:
        try:
            metadata_raw = read_length_prefixed(sys.stdin.buffer)
        except EOFError:
            log("sidecar: stdin closed, exiting")
            return 0

        if metadata_raw is None:
            log("sidecar: received shutdown request")
            return 0

        try:
            request = parse_request_metadata(metadata_raw)
            operation = request.get("op", "transcribe")
            if operation == "stream":
                if not engine.supports_streaming:
                    emit_error(
                        "The active local model does not support live streaming.",
                        "streaming_not_supported",
                    )
                    continue

                stream_bytes = 0

                def read_next_stream_frame() -> bytes | None:
                    nonlocal stream_bytes
                    frame = read_stream_audio_frame(sys.stdin.buffer, stream_bytes)
                    if frame is not None:
                        stream_bytes += len(frame)
                    return frame

                try:
                    engine.stream(read_next_stream_frame)
                except Exception as exc:
                    # Streaming model state cannot be reused after a protocol
                    # or inference failure. Exit so main starts a clean process
                    # instead of reading from a desynchronized stdin stream.
                    log_exception(exc, include_traceback=True)
                    emit_error(str(exc), "streaming_failed")
                    return 1
                continue
            if operation != "transcribe":
                emit_error("Unknown local STT operation.", "unknown_operation")
                continue
            prompt = request.get("prompt")
            if prompt is not None and not isinstance(prompt, str):
                prompt = None

            # Unlike the metadata frame above, a zero-length audio frame is a
            # legitimate (if degenerate) request, not a shutdown signal, so
            # read it directly rather than via read_length_prefixed().
            audio_length_bytes = read_exact(sys.stdin.buffer, 4)
            audio_length = struct.unpack("<I", audio_length_bytes)[0]
            if audio_length > MAX_AUDIO_REQUEST_BYTES:
                # Consume the frame before continuing so the stream remains
                # aligned for the next request, but never materialize it as a
                # model input.
                while audio_length:
                    chunk = read_exact(sys.stdin.buffer, min(audio_length, 64 * 1024))
                    audio_length -= len(chunk)
                emit_error(
                    "Local transcription request exceeds the 30-second safety limit",
                    "audio_too_long",
                )
                continue
            raw = read_exact(sys.stdin.buffer, audio_length)

            engine.transcribe(pcm16_to_float32(raw), prompt=prompt)
        except EOFError:
            log("sidecar: stdin closed mid-request, exiting")
            return 0
        except Exception as exc:
            log_exception(exc, include_traceback=True)
            emit_error(str(exc), "transcription_failed")


def oneshot_mode(engine: Engine) -> int:
    try:
        engine.load()
        raw = sys.stdin.buffer.read()
        engine.transcribe(pcm16_to_float32(raw))
        return 0
    except Exception as exc:
        log_exception(exc, include_traceback=True)
        emit_error(str(exc), "oneshot_failed")
        return 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Spoke MLX STT sidecar")
    parser.add_argument(
        "--family",
        choices=("whisper", "cohere", "parakeet", "nemotron"),
        default="whisper",
        help="ASR engine family to run (default: whisper).",
    )
    parser.add_argument(
        "--weights-dir",
        type=Path,
        default=Path(__file__).parent / "weights",
        help="Path to the installed MLX model directory.",
    )
    parser.add_argument(
        "--language",
        default="en",
        help="Language code, or 'auto' to enable language detection (whisper).",
    )
    parser.add_argument(
        "--oneshot",
        action="store_true",
        help="Read raw PCM16 from stdin once, transcribe, and exit.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    language = args.language.strip().lower()
    engine = build_engine(
        family=args.family,
        weights_dir=args.weights_dir.expanduser(),
        language=None if language == "auto" else language,
    )
    log(f"sidecar: family={args.family}")
    log(f"sidecar: profiling={'enabled' if is_enabled(PROFILE_MODE) else 'disabled'}")
    log(
        "sidecar: clear_cache="
        f"{'enabled' if is_enabled(CLEAR_CACHE_MODE) else 'disabled'}"
    )

    if args.oneshot:
        return oneshot_mode(engine)
    return daemon_mode(engine)


if __name__ == "__main__":
    raise SystemExit(main())
