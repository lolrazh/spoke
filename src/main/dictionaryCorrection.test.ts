import { describe, expect, it } from "vitest";
import { correctTranscript } from "./dictionaryCorrection";
import { isDictionaryWord } from "./dictionaryMembership";
import type { CorrectionTrace } from "../../shared/contextDebug";

describe("main/dictionaryCorrection", () => {
  it("records phrase decisions without changing the normal correction result", () => {
    const trace: CorrectionTrace[] = [];
    const input = "D flash two";
    expect(correctTranscript(input, ["DFlash2"], trace)).toBe(correctTranscript(input, ["DFlash2"]));
    expect(correctTranscript(input, ["DFlash2"])).toBe("DFlash2");
    expect(trace).toContainEqual(expect.objectContaining({ kind: "phrase", source: "D flash two", target: "DFlash2", path: "exact-phrase" }));
  });
  it.each([
    ["Use D flash two today.", "Use DFlash2 today."],
    ["Use D flash 2 today.", "Use DFlash2 today."],
    ["Use Dflash two today.", "Use DFlash2 today."],
    ["DFlash2", "DFlash2"],
    ["Use D flash today.", "Use D flash today."],
    ["Use Dflash today.", "Use Dflash today."],
    ["Use D flash three today.", "Use D flash three today."],
    ["Use DFlash3 today.", "Use DFlash3 today."],
    ["D flash to the left.", "D flash to the left."],
    ["D flash too.", "D flash too."],
    ["D flash. Two files.", "D flash. Two files."],
    ["D flash\ntwo files.", "D flash\ntwo files."],
  ])("matches the full numbered identifier, preserving other words: %s", (input, expected) => {
    expect(correctTranscript(input, ["DFlash2"])).toBe(expected);
  });
  it("keeps digits intact across competing entries", () => {
    expect(correctTranscript("D flash two", ["DFlash2", "DFlash3"])).toBe("DFlash2");
    expect(correctTranscript("D flash four", ["DFlash2", "DFlash3"])).toBe("D flash four");
    expect(correctTranscript("D flash two", ["DFlash2", "D Flash 2"])).toBe("D flash two");
    expect(correctTranscript("DFlash2", ["DFlash"])).toBe("DFlash2");
  });
  it("repairs one spoken letter in a numbered acronym without changing its version", () => {
    expect(correctTranscript("Try NBFP4 as well.", ["NVFP4"])).toBe("Try NVFP4 as well.");
    expect(correctTranscript("Try NBFP5 as well.", ["NVFP4"])).toBe("Try NBFP5 as well.");
    expect(correctTranscript("Try NBFP4 as well.", ["NVFP4", "NAFP4"])).toBe("Try NBFP4 as well.");
    expect(correctTranscript("NBFP4", ["NVFP4", "NPFP4"])).toBe("NBFP4");
    expect(correctTranscript("Try NBFP4 as well.", ["NBFP4", "NVFP4"])).toBe("Try NBFP4 as well.");
    expect(correctTranscript("Class4", ["GLASS4"])).toBe("Class4");
  });
  it("handles numbered entries without internal capitals", () => {
    expect(correctTranscript("Use Llama three", ["Llama3"])).toBe("Use Llama3");
    expect(correctTranscript("Use H two O", ["H2O"])).toBe("Use H2O");
  });
  it("repairs a voiced initial only when the rest of a spoken identifier is exact", () => {
    expect(correctTranscript("Use T flash 2.", ["DFlash2"])).toBe("Use DFlash2.");
    expect(correctTranscript("Use T flash two.", ["DFlash2"])).toBe("Use DFlash2.");
    expect(correctTranscript("Use T flash three.", ["DFlash2"])).toBe("Use T flash three.");
    expect(correctTranscript("Tflash2", ["DFlash2"])).toBe("Tflash2");
    expect(correctTranscript("G lass 4", ["Class4"])).toBe("G lass 4");
    expect(correctTranscript("T flash 2", ["DFlash2", "TFlash2"])).toBe("TFlash2");
    expect(correctTranscript("T flash 2", ["DFlash2", "D Flash 2"])).toBe("T flash 2");
    expect(correctTranscript("T flash two", ["DFlash2", "TFlash2", "T Flash 2"])).toBe("T flash two");
  });
  it("corrects a phonetically garbled name against the dictionary", () => {
    expect(
      correctTranscript("I met with Sandheap yesterday", ["Sandheep"]),
    ).toBe("I met with Sandheep yesterday");
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
    expect(correctTranscript("Say Kob loudly", ["Kobe"])).toBe(
      "Say Kob loudly",
    );
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

  it("joins a phonetic two-token transcription into a compound entry", () => {
    expect(
      correctTranscript("We use Charge B, for billing", ["ChargeBee"]),
    ).toBe("We use ChargeBee, for billing");
  });

  it("joins a four-token spelling into one canonical entry", () => {
    expect(correctTranscript("Ask Chat G P T for help", ["ChatGPT"])).toBe(
      "Ask ChatGPT for help",
    );
  });

  it("normalizes spacing inside a compound entry", () => {
    expect(correctTranscript("The Open AI API is ready", ["OpenAI"])).toBe(
      "The OpenAI API is ready",
    );
    expect(correctTranscript("I use a Mac Book Pro", ["MacBook Pro"])).toBe(
      "I use a MacBook Pro",
    );
  });

  it("matches a spoken ampersand form", () => {
    expect(correctTranscript("Send this to R and D today", ["R&D"])).toBe(
      "Send this to R&D today",
    );
  });

  it("does not match phrases across sentence punctuation", () => {
    expect(correctTranscript("I chose Open. AI is useful", ["OpenAI"])).toBe(
      "I chose Open. AI is useful",
    );
    expect(correctTranscript("I chose Open\nAI today", ["OpenAI"])).toBe(
      "I chose Open\nAI today",
    );
  });

  it("keeps ordinary title-cased names on the single-token path", () => {
    expect(correctTranscript("Ask Car In now", ["Karin"])).toBe(
      "Ask Car In now",
    );
  });

  it("prefers the longest exact phrase without swallowing its neighbor", () => {
    expect(correctTranscript("Use Open AI GPT today", ["OpenAI", "GPT"])).toBe(
      "Use OpenAI GPT today",
    );
  });

  it("rejects an ambiguous phrase match", () => {
    expect(correctTranscript("Try Open AI today", ["OpenAI", "Open AI"])).toBe(
      "Try Open AI today",
    );
  });

  it("does not turn an ambiguous phonetic phrase into a fuzzy winner", () => {
    const text = "Say Super califragilistic expialidociouz now";
    expect(
      correctTranscript(text, [
        "SupercalifragilisticExpialidocious",
        "SupercalifragilisticExpialadocious",
      ]),
    ).toBe(text);
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
    expect(
      correctTranscript("hello there", "oops" as unknown as string[]),
    ).toBe("hello there");
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
