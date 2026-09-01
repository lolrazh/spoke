from __future__ import annotations

import unittest
from types import SimpleNamespace

from nemotron_streaming import (
    NEMOTRON_ATT_CONTEXT_SIZE,
    NEMOTRON_ENCODER_FRAME_SECONDS,
    NEMOTRON_FINAL_SILENCE_SECONDS,
    NEMOTRON_STREAM_CHUNK_SECONDS,
    NEMOTRON_SUPPORTED_RIGHT_CONTEXTS,
    _final_silence_sample_count,
)


class AttentionProfileContractTests(unittest.TestCase):
    def test_uses_the_560_ms_profile(self) -> None:
        self.assertIn(
            NEMOTRON_ATT_CONTEXT_SIZE[1],
            NEMOTRON_SUPPORTED_RIGHT_CONTEXTS,
        )
        self.assertEqual(NEMOTRON_ATT_CONTEXT_SIZE, [56, 6])
        self.assertEqual(
            NEMOTRON_STREAM_CHUNK_SECONDS,
            (NEMOTRON_ATT_CONTEXT_SIZE[1] + 1)
            * NEMOTRON_ENCODER_FRAME_SECONDS,
        )
        self.assertEqual(NEMOTRON_STREAM_CHUNK_SECONDS, 0.56)


class FinalSilenceSampleCountTests(unittest.TestCase):
    def setUp(self) -> None:
        self.model = SimpleNamespace(
            preprocessor_config=SimpleNamespace(
                sample_rate=16_000,
                hop_length=160,
            ),
            encoder_config=SimpleNamespace(subsampling_factor=8),
        )

    def test_keeps_padding_between_400_and_480_ms(self) -> None:
        minimum = round(16_000 * NEMOTRON_FINAL_SILENCE_SECONDS)
        encoder_frame = 8 * 160

        for total_samples in range(0, encoder_frame * 3, 137):
            padding = _final_silence_sample_count(self.model, total_samples)
            self.assertGreaterEqual(padding, minimum)
            self.assertLess(padding, minimum + encoder_frame)

    def test_ends_one_mel_hop_past_an_encoder_frame_boundary(self) -> None:
        encoder_frame = 8 * 160

        for total_samples in (0, 160, 1_280, 32_137, 160_000):
            padding = _final_silence_sample_count(self.model, total_samples)
            self.assertEqual((total_samples + padding) % encoder_frame, 160)


if __name__ == "__main__":
    unittest.main()
