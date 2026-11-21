"""Opt-in test of real model inference through the framed sidecar protocol.

Set SPOKE_PARAKEET_TEST_WAV to a local PCM16/16 kHz/mono recording of:
"Use D flash two for this project. Test N V F P four as well."
No fixture or model is downloaded. Normal CI skips this model test.
"""

import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import unittest
import wave


def frame(data: bytes) -> bytes:
    return struct.pack("<I", len(data)) + data


@unittest.skipUnless(os.environ.get("SPOKE_PARAKEET_TEST_WAV"), "requires local speech fixture and weights")
class RealDecoderProtocolTests(unittest.TestCase):
    def run_requests(self, requests):
        weights = Path(os.environ.get(
            "SPOKE_PARAKEET_TEST_WEIGHTS",
            str(Path.home() / "Library/Application Support/Spoke/local-stt/weights/parakeet"),
        ))
        payload = b"".join(frame(json.dumps(meta).encode()) + frame(audio) for meta, audio in requests)
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("sidecar.py")),
             "--family", "parakeet", "--weights-dir", str(weights)],
            input=payload + frame(b""), capture_output=True, timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        events = [json.loads(line) for line in result.stdout.splitlines()]
        replies = [event for event in events if event["type"] in ("done", "error")]
        self.assertEqual(len(replies), len(requests), events)
        return replies

    def test_boosting_is_request_local_and_bad_metadata_does_not_desync_audio(self):
        with wave.open(os.environ["SPOKE_PARAKEET_TEST_WAV"]) as source:
            self.assertEqual((source.getframerate(), source.getsampwidth(), source.getnchannels()), (16000, 2, 1))
            pcm = source.readframes(source.getnframes())
        requests = [
            ({"boost_terms": ["DFlash2", "NVFP4"], "boost_strength": 4}, pcm),
            ({}, pcm),
            ({"boost_terms": ["TooMany"] * 25}, pcm),
            ({"boost_terms": [], "boost_strength": 4}, pcm),
            ({"boost_terms": ["DFlash2", "NVFP4"]}, bytes(32000)),
            ({"boost_terms": ["DFlash2", "NVFP4"]}, pcm),
        ]
        replies = self.run_requests(requests)
        self.assertEqual(replies[0]["transcript"], "Use DFlash2 for this project. Test NVFP4 as well.")
        self.assertEqual(replies[0]["metrics"]["decoder_mode"], "beam")
        self.assertEqual(replies[0]["metrics"]["boost_term_count"], 2)
        self.assertNotIn("DFlash2", replies[1]["transcript"])
        self.assertEqual(replies[1]["metrics"]["decoder_mode"], "greedy")
        self.assertEqual(replies[2]["type"], "error")
        self.assertEqual(replies[3]["transcript"], replies[1]["transcript"])
        self.assertEqual(replies[4]["transcript"], "")
        self.assertEqual(replies[4]["metrics"]["decoder_mode"], "skipped")
        self.assertEqual(replies[5]["transcript"], replies[0]["transcript"])
        for reply in replies:
            if reply["type"] == "done":
                self.assertEqual(reply["metrics"]["parakeet_word_boost"], 1)

    @unittest.skipUnless(os.environ.get("SPOKE_PARAKEET_SHORT_TEST_WAV"), "requires short DFlash2 fixture")
    def test_short_name_does_not_turn_into_repeated_shorter_hint(self):
        with wave.open(os.environ["SPOKE_PARAKEET_SHORT_TEST_WAV"]) as source:
            self.assertEqual((source.getframerate(), source.getsampwidth(), source.getnchannels()), (16000, 2, 1))
            pcm = source.readframes(source.getnframes())
        replies = self.run_requests([
            ({"boost_terms": ["M4", "DFlash2", "NVFP4"]}, pcm),
        ])
        self.assertEqual(replies[0]["transcript"].lower(), "dflash2.")
        self.assertEqual(replies[0]["metrics"]["boost_policy"], "length-scaled")


if __name__ == "__main__":
    unittest.main()
