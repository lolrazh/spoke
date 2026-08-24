"""Pinned mlx-audio adapter for one live Nemotron ASR session.

This module is the only place where Spoke uses Nemotron's model-specific
streaming internals. mlx-audio 0.5.0 owns the bounded log-mel, Conformer, and
RNN-T state. The sidecar supplies live PCM frames through ``read_pcm_frame``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import mlx.core as mx
import numpy as np
from mlx_audio.stt.models.nemotron_asr.audio import StreamingLogMelSpectrogram
from mlx_audio.stt.models.nemotron_asr.streaming import stream_encode_chunks


# Nemotron exposes latency profiles through its encoder right-context. Two
# encoder frames at 80 ms each give Spoke a 160 ms live update cadence.
NEMOTRON_STREAM_CHUNK_SECONDS = 0.16
NEMOTRON_ATT_CONTEXT_SIZE = [56, 1]


def stream_results(
    model: Any,
    read_pcm_frame: Callable[[], bytes | None],
    *,
    language: str = "en-US",
) -> Iterator[Any]:
    """Yield cumulative aligned results while PCM frames arrive.

    ``None`` is the stream-final marker. Audio is mono PCM16 at 16 kHz. The
    waveform is never retained: the mlx-audio frontend keeps only the samples
    required for its next centered STFT frame.
    """

    frontend = StreamingLogMelSpectrogram(model.preprocessor_config)

    def mel_chunks() -> Iterator[mx.array]:
        while True:
            raw = read_pcm_frame()
            if raw is None:
                mel = frontend.flush()
                if mel.shape[1] > 0:
                    yield mel
                return

            samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
            mel = frontend.push(mx.array(samples))
            if mel.shape[1] > 0:
                yield mel

    prompted_chunks = stream_encode_chunks(
        model,
        mel_chunks(),
        language,
        att_context_size=NEMOTRON_ATT_CONTEXT_SIZE,
    )
    try:
        yield from model._decode_prompted_chunks(prompted_chunks)
    finally:
        mx.clear_cache()
