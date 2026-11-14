import { describe, expect, it } from "vitest";
import { buildParakeetBoost } from "./parakeetBoost";

describe("Parakeet decoder terms", () => {
  it("keeps visible names first and uses saved canonical spelling", () => {
    const saved = ["DFlash2", ...Array.from({ length: 50 }, (_, i) => `Saved${i}`)];
    const result = buildParakeetBoost(["dflash2", "NVFP4"], saved);
    expect(result.terms.slice(0, 2)).toEqual(["DFlash2", "NVFP4"]);
    expect(result.terms).toHaveLength(24);
    expect(result.terms.filter(term => term === "DFlash2")).toHaveLength(1);
  });

  it("rejects empty terms, control characters, bare numbers, and oversized terms", () => {
    expect(buildParakeetBoost(["", "123", "one\ntwo", "a".repeat(81)], []).terms).toEqual([]);
  });
});
