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


# NVIDIA declares right contexts {0, 1, 3, 6, 13} as runtime operating points
# for this checkpoint. Use the trained 320 ms profile because it produced the
# lowest WER in Spoke's cadence comparison.
NEMOTRON_ENCODER_FRAME_SECONDS = 0.08
NEMOTRON_SUPPORTED_RIGHT_CONTEXTS = frozenset({0, 1, 3, 6, 13})
NEMOTRON_ATT_CONTEXT_SIZE = [56, 3]
NEMOTRON_STREAM_CHUNK_SECONDS = (
    NEMOTRON_ATT_CONTEXT_SIZE[1] + 1
) * NEMOTRON_ENCODER_FRAME_SECONDS
NEMOTRON_FINAL_SILENCE_SECONDS = 0.4


def _final_silence_sample_count(model: Any, total_samples: int) -> int:
    """Return bounded endpoint padding for the RNN-T final hypothesis.

    Nemotron can emit its last word and punctuation only after it decodes an
    acoustic pause. Keep this padding inside inference so capture does not wait
    for another 400 ms of microphone audio. Ending one mel hop past an 80 ms
    encoder frame boundary also guarantees that finalization has a boundary
    frame to decode instead of landing exactly between chunks.
    """

    sample_rate = model.preprocessor_config.sample_rate
    hop_length = model.preprocessor_config.hop_length
    encoder_frame_samples = model.encoder_config.subsampling_factor * hop_length
    minimum_samples = round(sample_rate * NEMOTRON_FINAL_SILENCE_SECONDS)
    target_remainder = hop_length
    alignment_samples = (
        target_remainder
        - (max(0, total_samples) + minimum_samples) % encoder_frame_samples
    ) % encoder_frame_samples
    return minimum_samples + alignment_samples


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
                silence_samples = _final_silence_sample_count(
                    model,
                    frontend.total_samples,
                )
                silence = mx.zeros((silence_samples,), dtype=mx.float32)
                mel = frontend.push(silence)
                if mel.shape[1] > 0:
                    yield mel
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
