#!/usr/bin/env python3
"""
Spoke local STT sidecar using Whisper large-v3 turbo 4-bit on MLX.

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
import struct
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import mlx.core as mx
import mlx_whisper
import numpy as np
from mlx_whisper.load_models import load_model
from mlx_whisper.transcribe import ModelHolder

MODEL_ID = "mlx-community/whisper-large-v3-turbo-4bit"
MODEL_DISPLAY_NAME = "Whisper large-v3 turbo 4-bit"
REQUIRED_MODEL_FILES = ("config.json", "weights.safetensors", "multilingual.tiktoken")
SAMPLE_RATE = 16000

# Conservative near-digital-silence gate. Whisper's own no_speech handling still
# decides ambiguous low-volume clips.
SILENCE_RMS_THRESHOLD = 0.0005
SILENCE_PEAK_THRESHOLD = 0.003


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


def validate_weights_dir(weights_dir: Path) -> None:
    missing = [name for name in REQUIRED_MODEL_FILES if not (weights_dir / name).exists()]
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


def audio_stats(audio: np.ndarray) -> dict[str, float | int | bool]:
    duration_ms = (len(audio) / SAMPLE_RATE) * 1000
    if audio.size == 0:
        return {
            "audio_duration_ms": 0,
            "audio_rms": 0.0,
            "audio_peak": 0.0,
            "is_silence": True,
        }

    centered = audio - float(np.mean(audio))
    rms = float(np.sqrt(np.mean(np.square(centered, dtype=np.float64))))
    peak = float(np.max(np.abs(centered)))
    is_silence = rms < SILENCE_RMS_THRESHOLD and peak < SILENCE_PEAK_THRESHOLD

    return {
        "audio_duration_ms": round(duration_ms),
        "audio_rms": rms,
        "audio_peak": peak,
        "is_silence": is_silence,
    }


class WhisperRuntime:
    def __init__(self, weights_dir: Path, language: str | None) -> None:
        self.weights_dir = weights_dir
        self.model_path = str(weights_dir)
        self.language = language
        self.load_ms: int | None = None
        self.load_peak_memory_bytes = 0

    def load(self) -> None:
        validate_weights_dir(self.weights_dir)

        log(f"sidecar: loading {MODEL_DISPLAY_NAME} from {self.weights_dir}")
        reset_peak_memory()
        start = time.perf_counter()

        model = load_model(self.model_path, dtype=mx.float16)
        ModelHolder.model = model
        ModelHolder.model_path = self.model_path

        self.load_ms = round((time.perf_counter() - start) * 1000)
        self.load_peak_memory_bytes = memory_snapshot()["peak_memory_bytes"]
        log(f"sidecar: model loaded in {self.load_ms} ms")

    def transcribe(self, audio: np.ndarray) -> None:
        stats = audio_stats(audio)
        log(
            "sidecar: received "
            f"{len(audio)} samples ({stats['audio_duration_ms']} ms)"
        )

        if stats["is_silence"]:
            metrics = self._metrics(
                stats=stats,
                inference_ms=0,
                transcript="",
                language=None,
                segment_count=0,
                memory=memory_snapshot(),
            )
            emit({"type": "done", "transcript": "", "metrics": metrics})
            log("sidecar: skipped near-silent audio")
            return

        reset_peak_memory()
        start = time.perf_counter()

        options: dict[str, Any] = {
            "fp16": True,
            "temperature": 0.0,
            "condition_on_previous_text": False,
            "no_speech_threshold": 0.6,
            "word_timestamps": False,
            "verbose": None,
        }
        if self.language is not None:
            options["language"] = self.language

        result = mlx_whisper.transcribe(
            audio,
            path_or_hf_repo=self.model_path,
            **options,
        )
        inference_ms = round((time.perf_counter() - start) * 1000)
        memory = memory_snapshot()
        clear_cache()

        transcript = str(result.get("text", "")).strip()
        segments = result.get("segments") or []
        metrics = self._metrics(
            stats=stats,
            inference_ms=inference_ms,
            transcript=transcript,
            language=result.get("language"),
            segment_count=len(segments),
            memory=memory,
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
    ) -> dict[str, Any]:
        return {
            "model_id": MODEL_ID,
            "model_load_ms": self.load_ms or 0,
            "model_load_peak_memory_bytes": self.load_peak_memory_bytes,
            "audio_duration_ms": stats["audio_duration_ms"],
            "audio_rms": stats["audio_rms"],
            "audio_peak": stats["audio_peak"],
            "is_silence": stats["is_silence"],
            "inference_ms": inference_ms,
            "ttft_ms": None,
            "word_count": len(transcript.split()) if transcript else 0,
            "language": language,
            "segment_count": segment_count,
            **memory,
        }


def daemon_mode(runtime: WhisperRuntime) -> int:
    try:
        runtime.load()
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
            runtime.transcribe(pcm16_to_float32(raw))
        except EOFError:
            log("sidecar: stdin closed mid-request, exiting")
            return 0
        except Exception as exc:
            log_exception(exc, include_traceback=True)
            emit_error(str(exc), "transcription_failed")


def oneshot_mode(runtime: WhisperRuntime) -> int:
    try:
        runtime.load()
        raw = sys.stdin.buffer.read()
        runtime.transcribe(pcm16_to_float32(raw))
        return 0
    except Exception as exc:
        log_exception(exc, include_traceback=True)
        emit_error(str(exc), "oneshot_failed")
        return 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Spoke MLX Whisper STT sidecar")
    parser.add_argument(
        "--weights-dir",
        type=Path,
        default=Path(__file__).parent / "weights",
        help="Path to the installed Whisper MLX model directory.",
    )
    parser.add_argument(
        "--language",
        default="en",
        help="Whisper language code, or 'auto' to enable language detection.",
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
    runtime = WhisperRuntime(
        weights_dir=args.weights_dir.expanduser(),
        language=None if language == "auto" else language,
    )

    if args.oneshot:
        return oneshot_mode(runtime)
    return daemon_mode(runtime)


if __name__ == "__main__":
    raise SystemExit(main())
