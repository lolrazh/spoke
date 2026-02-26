#!/usr/bin/env python3
"""
Sidecar-style Moonshine v2 transcription for Spoke integration.

Uses MLX (Apple Silicon native) for fast, lightweight inference.
Streams partial results as tokens are decoded.

DAEMON MODE (default):
  Model loads once, emits {"type":"ready"}, then reads length-prefixed PCM16
  requests in a loop. Each request: 4 bytes LE uint32 length + that many bytes
  of raw PCM16 audio. Exits on stdin EOF or zero-length message.

ONE-SHOT MODE (--oneshot flag):
  Reads raw PCM16 (s16le, 16kHz, mono) audio from stdin until EOF.
  Writes transcription JSON lines to stdout.

Protocol (stdout, one JSON line per event):
  {"type":"ready"}                                     (daemon mode only)
  {"type":"partial","text":"Ever tried, ever "}
  {"type":"done","transcript":"Ever tried, ever failed, no matter.","metrics":{...}}
"""

import sys
import json
import time
import struct
from pathlib import Path

import numpy as np
import mlx.core as mx
from tokenizers import Tokenizer

from moonshine_mlx import MoonshineMLX

WEIGHTS_DIR = Path(__file__).parent / "weights"
SAMPLE_RATE = 16000


def log(msg: str):
    """Write to stderr for diagnostics."""
    print(msg, file=sys.stderr, flush=True)


def emit(obj: dict):
    """Write a JSON line to stdout."""
    print(json.dumps(obj), flush=True)


def load_model():
    """Load the MLX model and tokenizer, return (model, tokenizer, load_ms)."""
    log("sidecar: loading model...")
    load_start = time.perf_counter()

    model = MoonshineMLX.from_pretrained(WEIGHTS_DIR)
    tokenizer = Tokenizer.from_file(str(WEIGHTS_DIR / "tokenizer.json"))

    load_ms = (time.perf_counter() - load_start) * 1000
    log(f"sidecar: model loaded in {load_ms:.0f} ms (MLX, Apple Silicon)")
    return model, tokenizer, load_ms


def transcribe(audio: np.ndarray, model: MoonshineMLX, tokenizer: Tokenizer, load_ms: float):
    """Run transcription on a float32 audio array. Emits partial + done events."""
    total_samples = len(audio)
    audio_duration_ms = (total_samples / SAMPLE_RATE) * 1000
    log(f"sidecar: received {total_samples} samples ({audio_duration_ms:.0f} ms)")

    infer_start = time.perf_counter()

    audio_mx = mx.array(audio[None, :])  # (1, samples)
    max_tokens = int(total_samples * 6.5 / SAMPLE_RATE)

    transcript = ""
    ttft_ms = None
    partial_ids = []

    def on_token(token_id):
        nonlocal transcript, ttft_ms
        partial_ids.append(token_id)
        if ttft_ms is None:
            ttft_ms = (time.perf_counter() - infer_start) * 1000
        transcript = tokenizer.decode(partial_ids)
        emit({"type": "partial", "text": transcript})

    # generate() returns repetition-trimmed token list
    final_ids = model.beam_search_generate(audio_mx, max_tokens, beam_width=3, callback=on_token)

    # Use trimmed tokens for final transcript (partials are best-effort)
    transcript = tokenizer.decode(final_ids) if final_ids else ""
    infer_ms = (time.perf_counter() - infer_start) * 1000

    metrics = {
        "model_load_ms": round(load_ms),
        "audio_duration_ms": round(audio_duration_ms),
        "inference_ms": round(infer_ms),
        "ttft_ms": round(ttft_ms) if ttft_ms else None,
        "word_count": len(transcript.split()) if transcript else 0,
    }

    emit({"type": "done", "transcript": transcript, "metrics": metrics})

    log(f"sidecar: done — {metrics['word_count']} words, "
        f"{metrics['inference_ms']} ms inference, "
        f"{metrics['ttft_ms']} ms ttft, "
        f"{metrics['audio_duration_ms']:.0f} ms audio")


def read_exact(stream, n: int) -> bytes:
    """Read exactly n bytes from a binary stream, or raise EOFError."""
    buf = b""
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            raise EOFError("stdin closed")
        buf += chunk
    return buf


def daemon_mode():
    """Long-running daemon: load model once, process length-prefixed requests."""
    model, tokenizer, load_ms = load_model()
    emit({"type": "ready"})

    log("sidecar: daemon ready, waiting for requests...")

    while True:
        try:
            length_bytes = read_exact(sys.stdin.buffer, 4)
        except EOFError:
            log("sidecar: stdin closed, exiting daemon")
            break

        length = struct.unpack("<I", length_bytes)[0]
        if length == 0:
            log("sidecar: received zero-length message, exiting daemon")
            break

        try:
            raw = read_exact(sys.stdin.buffer, length)
        except EOFError:
            log("sidecar: stdin closed mid-read, exiting daemon")
            break

        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        transcribe(audio, model, tokenizer, load_ms)


def oneshot_mode():
    """Original one-shot mode: read all stdin, transcribe, exit."""
    model, tokenizer, load_ms = load_model()

    log("sidecar: reading PCM16 s16le 16kHz mono from stdin...")
    raw = sys.stdin.buffer.read()
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    transcribe(audio, model, tokenizer, load_ms)


if __name__ == "__main__":
    if "--oneshot" in sys.argv:
        oneshot_mode()
    else:
        daemon_mode()
