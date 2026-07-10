import { describe, expect, it } from "vitest";
import { correctTranscript, isDictionaryWord } from "./dictionaryCorrection";

describe("main/dictionaryCorrection", () => {
  it("corrects a phonetically garbled name against the dictionary", () => {
    expect(correctTranscript("I met with Sandheap yesterday", ["Sandheep"])).toBe(
      "I met with Sandheep yesterday",
    );
  });

  it("is idempotent when run on its own output", () => {
    const dictionary = ["Sandheep"];
    const once = correctTranscript("I met with Sandheap yesterday", dictionary);
    expect(correctTranscript(once, dictionary)).toBe(once);
  });

  it("returns the text unchanged for an empty dictionary", () => {
    const text = "Sandheap never gets touched here";
    expect(correctTranscript(text, [])).toBe(text);
  });

  it("never corrects a short token even when it phonetically matches", () => {
    // "Kob" shares Kobe's phonetics but is <= 3 chars, so it is left alone.
    expect(correctTranscript("Say Kob loudly", ["Kobe"])).toBe("Say Kob loudly");
  });

  it("never corrects a common word close to a dictionary entry", () => {
    // "Thera" and "there" share a metaphone code and are edit-distance close;
    // "there" is a common word and must survive untouched.
    expect(correctTranscript("Is there a meeting", ["Thera"])).toBe(
      "Is there a meeting",
    );
  });

  it("passes unrelated words through untouched", () => {
    expect(correctTranscript("The quick brown fox", ["Sandheep"])).toBe(
      "The quick brown fox",
    );
  });

  it("preserves whitespace, punctuation, and newlines around a correction", () => {
    expect(correctTranscript("Hello, Sandheap.\nBye now", ["Sandheep"])).toBe(
      "Hello, Sandheep.\nBye now",
    );
  });

  it("corrects a possessive stem and reattaches the possessive", () => {
    expect(correctTranscript("Sandheap's car is here", ["Sandheep"])).toBe(
      "Sandheep's car is here",
    );
  });

  it("leaves an already-correct dictionary word as-is", () => {
    expect(correctTranscript("I use RapidFuzz daily", ["RapidFuzz"])).toBe(
      "I use RapidFuzz daily",
    );
  });

  it("corrects each word of a multi-word entry independently", () => {
    expect(
      correctTranscript("I saw Sandheap and later Rajkumer", [
        "Sandheep Rajkumar",
      ]),
    ).toBe("I saw Sandheep and later Rajkumar");
  });

  it("keeps a capitalized token capitalized when the entry is lowercase", () => {
    expect(correctTranscript("I met Sandheep today", ["sandheep"])).toBe(
      "I met Sandheep today",
    );
  });

  it("inherits the token's leading capital on a phonetic correction", () => {
    expect(correctTranscript("I met Sandheap today", ["sandheep"])).toBe(
      "I met Sandheep today",
    );
  });

  it("enforces an entry's intentional casing on a lowercase token", () => {
    expect(correctTranscript("we use rapidfuzz here", ["RapidFuzz"])).toBe(
      "we use RapidFuzz here",
    );
  });

  it("never serves a stale cached index after the dictionary changes", () => {
    // Same input, three dictionaries: the cached index must follow the
    // reference passed in, not the first one it ever saw.
    expect(correctTranscript("I met Sandheap", ["Sandheep"])).toBe(
      "I met Sandheep",
    );
    expect(correctTranscript("I met Sandheap", ["Rajkumar"])).toBe(
      "I met Sandheap",
    );
    expect(correctTranscript("I met Sandheap", ["Sandheep"])).toBe(
      "I met Sandheep",
    );
  });

  it("survives a malformed dictionary from a corrupt prefs file", () => {
    // Transcription must never fail because prefs JSON has the wrong shape.
    const junk = [42, null, "Sandheep"] as unknown as string[];
    expect(correctTranscript("I met Sandheap today", junk)).toBe(
      "I met Sandheep today",
    );
    expect(correctTranscript("hello there", "oops" as unknown as string[])).toBe(
      "hello there",
    );
  });

  it("does not correct when two candidates are a near-tie", () => {
    // "Karan" is equidistant from both entries (similarity 0.8 each), so there
    // is no clear winner and it must be left unchanged.
    expect(correctTranscript("Ask Karan about it", ["Karin", "Karen"])).toBe(
      "Ask Karan about it",
    );
  });
});

describe("main/dictionaryCorrection isDictionaryWord", () => {
  it("matches a dictionary word case-insensitively", () => {
    expect(isDictionaryWord("sandheep", ["Sandheep"])).toBe(true);
    expect(isDictionaryWord("SANDHEEP", ["Sandheep"])).toBe(true);
  });

  it("matches an individual word from a multi-word entry", () => {
    expect(isDictionaryWord("rajkumar", ["Sandheep Rajkumar"])).toBe(true);
  });

  it("returns false for a word that is not in the dictionary", () => {
    expect(isDictionaryWord("banana", ["Sandheep"])).toBe(false);
  });
});
