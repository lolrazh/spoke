import { describe, expect, it } from "vitest";
import { buildParakeetBoost, MAX_BOOST_TERMS, withBoostedTerms } from "./parakeetBoost";

describe("Parakeet decoder terms", () => {
  it("boosts visible names only and uses saved canonical spelling", () => {
    const saved = ["DFlash2", ...Array.from({ length: 50 }, (_, i) => `Saved${i}`)];
    const result = buildParakeetBoost(["dflash2", "NVFP4", "DFLASH2"], saved);
    expect(result).toEqual({ terms: ["DFlash2", "NVFP4"], strength: 4 });
  });

  it("keeps only the first screen terms, in their distinctiveness order", () => {
    const screen = Array.from({ length: 24 }, (_, i) => `Visible${i}`);
    const result = buildParakeetBoost(screen, ["Saved"]);
    expect(result.terms).toEqual(screen.slice(0, MAX_BOOST_TERMS));
  });

  it("sends no terms when the window has none, whatever is saved", () => {
    expect(buildParakeetBoost([], ["DFlash2", "GitHub"]).terms).toEqual([]);
  });

  it("rejects empty terms, control characters, bare numbers, and oversized terms", () => {
    expect(buildParakeetBoost(["", "123", "one\ntwo", "a".repeat(81)], []).terms).toEqual([]);
  });

  it("does not let rejected terms use up the limit", () => {
    const screen = ["123", "", ...Array.from({ length: MAX_BOOST_TERMS }, (_, i) => `Visible${i}`)];
    expect(buildParakeetBoost(screen, []).terms).toHaveLength(MAX_BOOST_TERMS);
  });
});

describe("Correction dictionary for a boosted request", () => {
  it("reuses the dictionary when it already holds every boosted term", () => {
    const dictionary = ["GitHub", "dflash2"];
    expect(withBoostedTerms(dictionary, ["DFlash2"])).toBe(dictionary);
  });

  it("adds a boosted term that the window no longer lists", () => {
    expect(withBoostedTerms(["GitHub"], ["DFlash2"])).toEqual(["GitHub", "DFlash2"]);
  });
});
