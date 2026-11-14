import unittest

from parakeet_boost import decoding_config, validate_boost


class BoostValidationTests(unittest.TestCase):
    def test_keeps_identifiers_and_names_without_duplicate_bias(self):
        self.assertEqual(validate_boost(["DFlash2", "dflash2", "Priyanka Sharma"]),
                         (("dflash2", "priyanka sharma"), 4.0))

    def test_empty_terms_use_fast_path_without_importing_model(self):
        self.assertIsNone(decoding_config([], 4.0, []))

    def test_rejects_unbounded_or_malformed_requests(self):
        for terms in ("DFlash2", None, [1], [""], ["a"], ["a" * 81],
                      ["one\ntwo"], ["$prompt"], ["1234"], ["DFlash2"] * 25):
            with self.subTest(terms=terms), self.assertRaises(ValueError):
                validate_boost(terms)
        for strength in (True, "4", None, 0, -1, 5, float("nan"), float("inf")):
            with self.subTest(strength=strength), self.assertRaises(ValueError):
                validate_boost(["DFlash2"], strength)


if __name__ == "__main__":
    unittest.main()
