#!/usr/bin/env python3
"""
Sidecar-style Moonshine v2 transcription for Spoke integration.

Uses full-precision model via HuggingFace Transformers (not quantized SDK).
Runs on MPS (Apple Silicon) with FP16 for best quality + speed.
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
import numpy as np
import torch
from threading import Thread
from transformers import MoonshineStreamingForConditionalGeneration, AutoProcessor, TextIteratorStreamer

MODEL_ID = "UsefulSensors/moonshine-streaming-medium"
SAMPLE_RATE = 16000


def log(msg: str):
    """Write to stderr for diagnostics."""
    print(msg, file=sys.stderr, flush=True)


def emit(obj: dict):
    """Write a JSON line to stdout."""
    print(json.dumps(obj), flush=True)


def load_model():
    """Load the Moonshine model and processor, return (model, processor, device, dtype, load_ms)."""
    log("sidecar: loading model...")
    load_start = time.perf_counter()

    if torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.float16
    else:
        device = "cpu"
        dtype = torch.float32

    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = MoonshineStreamingForConditionalGeneration.from_pretrained(MODEL_ID)
    model = model.to(device).to(dtype)

    load_ms = (time.perf_counter() - load_start) * 1000
    log(f"sidecar: model loaded in {load_ms:.0f} ms ({device}, {dtype})")
    return model, processor, device, dtype, load_ms


def transcribe(audio: np.ndarray, model, processor, device, dtype, load_ms: float):
    """Run transcription on a float32 audio array. Emits partial + done events."""
    total_samples = len(audio)
    audio_duration_ms = (total_samples / SAMPLE_RATE) * 1000
    log(f"sidecar: received {total_samples} samples ({audio_duration_ms:.0f} ms)")

    infer_start = time.perf_counter()

    inputs = processor(audio, return_tensors="pt", sampling_rate=SAMPLE_RATE)
    inputs = inputs.to(device, dtype)

    token_limit_factor = 6.5 / SAMPLE_RATE
    seq_lens = inputs.attention_mask.sum(dim=-1)
    max_length = int((seq_lens * token_limit_factor).max().item())

    streamer = TextIteratorStreamer(processor.tokenizer, skip_special_tokens=True)
    gen_kwargs = {**inputs, "max_length": max_length, "streamer": streamer}

    thread = Thread(target=model.generate, kwargs=gen_kwargs)
    thread.start()

    transcript = ""
    ttft_ms = None
    for token_text in streamer:
        if not token_text:
            continue
        if ttft_ms is None:
            ttft_ms = (time.perf_counter() - infer_start) * 1000
        transcript += token_text
        emit({"type": "partial", "text": transcript})

    thread.join()
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
    model, processor, device, dtype, load_ms = load_model()
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
        transcribe(audio, model, processor, device, dtype, load_ms)


def oneshot_mode():
    """Original one-shot mode: read all stdin, transcribe, exit."""
    model, processor, device, dtype, load_ms = load_model()

    log("sidecar: reading PCM16 s16le 16kHz mono from stdin...")
    raw = sys.stdin.buffer.read()
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    transcribe(audio, model, processor, device, dtype, load_ms)


if __name__ == "__main__":
    if "--oneshot" in sys.argv:
        oneshot_mode()
    else:
        daemon_mode()
