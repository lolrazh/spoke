"""Bounded, request-local vocabulary hints for upstream Parakeet beam decoding."""

import math
import unicodedata

# A fixed phrase reward otherwise gives a two-character name much more credit
# per character than a longer identifier. Keep the tested long-name strength,
# but scale shorter terms. This changes scoring, not screen-term selection.
FULL_BOOST_CHARACTERS = 7


def validate_boost(terms, strength=4.0) -> tuple[tuple[str, ...], float]:
    if not isinstance(terms, (list, tuple)) or len(terms) > 24:
        raise ValueError("boost_terms must contain at most 24 strings")
    if (isinstance(strength, bool) or not isinstance(strength, (int, float))
            or not math.isfinite(strength) or not 0 < strength <= 4):
        raise ValueError("boost_strength must be a finite number in (0, 4]")
    selected: dict[str, None] = {}
    for term in terms:
        if not isinstance(term, str):
            raise ValueError("boost terms must be strings")
        term = term.strip()
        if (not 2 <= len(term) <= 80 or not any(c.isalpha() for c in term)
                or not all(unicodedata.category(c)[0] in "LMN" or c in " ._'’+-" for c in term)):
            raise ValueError("invalid boost term")
        selected.setdefault(term.lower(), None)
    return tuple(selected), float(strength)


def phrase_weights(terms, strength) -> dict[str, float]:
    terms, strength = validate_boost(terms, strength)
    return {
        term: strength * min(1.0, len(term) / FULL_BOOST_CHARACTERS)
        for term in terms
    }


def decoding_config(terms, strength, vocabulary):
    weights = phrase_weights(terms, strength)
    if not weights:
        return None
    # Keep imports lazy: the other engines do not need Parakeet or its booster.
    from parakeet_mlx import Beam, DecodingConfig, boost

    machine = boost.lift(
        boost.prebind(str.lower, boost.words(weights)),
        vocabulary,
    )
    return DecodingConfig(decoding=Beam(
        beam_size=2, duration_reward=0.7, booster=machine,
    ))
