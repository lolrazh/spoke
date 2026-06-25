#!/usr/bin/env python3
"""
Spoke MLX STT sidecar supporting two ASR engine families: Whisper and Cohere.

The engine family is selected with --family {whisper,cohere} (default whisper
for back-compat). Whisper uses mlx_whisper (large-v3 turbo 4-bit); Cohere uses
mlx-speech (CohereAsrModel). Heavy per-family imports are loaded lazily so that
selecting one family never imports the other.

Daemon mode loads the model once, emits {"type":"ready"}, then reads requests
as 4-byte little-endian length + raw PCM16 mono 16 kHz audio.

Protocol stdout events:
  {"type":"ready"}
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

# Whisper consumes 16 kHz mono PCM, and so does Cohere. Keep a single shared
# constant; the Whisper engine asserts it matches mlx_whisper's SAMPLE_RATE.
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
FAST_ATTENTION_MODE = os.environ.get("SPOKE_STT_FAST_ATTENTION", "0").strip().lower()
SAMPLE_LEN_LIMIT = os.environ.get("SPOKE_STT_SAMPLE_LEN", "").strip()
PROFILE_MODE = os.environ.get("SPOKE_STT_PROFILE", "0").strip().lower()
WARMUP_MODE = os.environ.get("SPOKE_STT_WARMUP", "1").strip().lower()
CLEAR_CACHE_MODE = os.environ.get("SPOKE_STT_CLEAR_CACHE", "1").strip().lower()
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
    transcribe(audio) -> emit a {"type":"done", ...} event for one request.
    """

    def load(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def warmup(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def transcribe(self, audio: np.ndarray) -> None:  # pragma: no cover - interface
        raise NotImplementedError


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
    )
    _whisper_imported = True


def install_fast_attention_patch() -> None:
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
    if mode not in ("all", "self", "cross"):
        raise ValueError(
            "SPOKE_STT_FAST_ATTENTION must be one of: 0, 1, all, self, cross"
        )
    if not hasattr(mx, "fast") or not hasattr(mx.fast, "scaled_dot_product_attention"):
        log("sidecar: fast attention unavailable")
        return

    MultiHeadAttention = _w["MultiHeadAttention"]
    original_qkv_attention = MultiHeadAttention.qkv_attention

    def fast_qkv_attention(self, q, k, v, mask=None):
        is_self_attention = mask is not None
        should_use_fast_attention = (
            mode == "all"
            or (mode == "self" and is_self_attention)
            or (mode == "cross" and not is_self_attention)
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
        install_fast_attention_patch()
        validate_weights_dir(self.weights_dir, WHISPER_REQUIRED_MODEL_FILES)

        log(f"sidecar: loading {WHISPER_MODEL_DISPLAY_NAME} from {self.weights_dir}")
        reset_peak_memory()
        start = time.perf_counter()

        self.model = _w["load_model"](self.model_path, dtype=mx.float16)

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

    def transcribe(self, audio: np.ndarray) -> None:
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

        result = transcribe_audio(self.model, audio, self.language, self.sample_len)
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
) -> dict[str, Any]:
    log_mel_spectrogram = _w["log_mel_spectrogram"]
    pad_or_trim = _w["pad_or_trim"]
    DecodingOptions = _w["DecodingOptions"]
    get_tokenizer = _w["get_tokenizer"]
    N_FRAMES = _w["N_FRAMES"]
    N_SAMPLES = _w["N_SAMPLES"]
    HOP_LENGTH = _w["HOP_LENGTH"]

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
        mel_segment = pad_or_trim(mel_segment, N_FRAMES, axis=-2).astype(dtype)
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

    def transcribe(self, audio: np.ndarray) -> None:
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
# IPC / daemon driver (engine-agnostic).
# ---------------------------------------------------------------------------


def build_engine(family: str, weights_dir: Path, language: str | None) -> Engine:
    if family == "whisper":
        return WhisperEngine(weights_dir=weights_dir, language=language)
    if family == "cohere":
        return CohereEngine(weights_dir=weights_dir, language=language)
    raise ValueError(f"Unknown engine family: {family}")


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
            length_bytes = read_exact(sys.stdin.buffer, 4)
        except EOFError:
            log("sidecar: stdin closed, exiting")
            return 0

        length = struct.unpack("<I", length_bytes)[0]
        if length == 0:
            log("sidecar: received shutdown request")
            return 0

        try:
            raw = read_exact(sys.stdin.buffer, length)
            engine.transcribe(pcm16_to_float32(raw))
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
        choices=("whisper", "cohere"),
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
