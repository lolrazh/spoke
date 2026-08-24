from __future__ import annotations

import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from urllib.request import urlopen

from nemotron_streaming import NEMOTRON_STREAM_CHUNK_SECONDS


@unittest.skipUnless(
    os.environ.get("SPOKE_RUN_NEMOTRON_INTEGRATION") == "1",
    "set SPOKE_RUN_NEMOTRON_INTEGRATION=1 to run the real-model test",
)
class RealSpeechStreamingTests(unittest.TestCase):
    # LibriSpeech dev-clean 1272-128104-0000 (CC BY 4.0), mirrored by Qwen.
    # The commit and digest pin the exact human-speech input.
    FIXTURE_URL = (
        "https://raw.githubusercontent.com/QwenLM/Qwen-Audio/"
        "b50fb958438081d36e1a14e93dbbc2f329c7f10e/"
        "assets/audio/1272-128104-0000.flac"
    )
    FIXTURE_SHA256 = (
        "4e25e22555cd16e90edb0a3b49fdcf1fe652b2a1250ab643634db33895c75b41"
    )
    EXPECTED_TEXT = (
        "Mr. Quilter is the apostle of the middle classes, and we are glad "
        "to welcome his gospel."
    )

    def test_streams_real_speech_through_frontend_encoder_and_decoder(self) -> None:
        import mlx.core as mx
        import numpy as np
        from mlx_audio.stt import load
        from mlx_audio.utils import load_audio

        from nemotron_streaming import stream_results

        weights_dir = Path(
            os.environ.get(
                "SPOKE_NEMOTRON_WEIGHTS_DIR",
                Path.home()
                / "Library/Application Support/Spoke/local-stt/weights/nemotron",
            )
        )
        self.assertTrue(weights_dir.is_dir(), f"missing weights: {weights_dir}")

        with tempfile.TemporaryDirectory(prefix="spoke-nemotron-test-") as temp_dir:
            fixture_path = Path(temp_dir) / "1272-128104-0000.flac"
            with urlopen(self.FIXTURE_URL, timeout=30) as response:
                fixture_bytes = response.read()
            self.assertEqual(
                hashlib.sha256(fixture_bytes).hexdigest(),
                self.FIXTURE_SHA256,
            )
            fixture_path.write_bytes(fixture_bytes)

            samples = np.asarray(load_audio(str(fixture_path), sample_rate=16_000))
            pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()

        model = load(str(weights_dir), lazy=False)
        chunk_bytes = round(16_000 * NEMOTRON_STREAM_CHUNK_SECONDS) * 2
        offset = 0

        def read_pcm_frame() -> bytes | None:
            nonlocal offset
            if offset >= len(pcm):
                return None
            frame = pcm[offset : offset + chunk_bytes]
            offset += len(frame)
            return frame

        partials: list[str] = []
        for result in stream_results(model, read_pcm_frame, language="en-US"):
            text = " ".join(result.text.split())
            if text and (not partials or partials[-1] != text):
                partials.append(text)

        self.assertGreaterEqual(len(partials), 10)
        self.assertEqual(partials[-1], self.EXPECTED_TEXT)
        mx.clear_cache()


if __name__ == "__main__":
    unittest.main()
