import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "./transcriptPostprocessing";

describe("live numbered acronym correction", () => {
  it("never applies dictionary replacement after Whisper decoding", () => {
    expect(normalizeTranscript("Use D flash two with github.", "whisper", ["DFlash2", "GitHub"]))
      .toBe("Use D flash two with github.");
  });
  it("corrects letters after the normalizer joins them and leaves the number separate", () => {
    expect(normalizeTranscript(
      "Use D flash 2 for this project. Test N P F P 4 as well.",
      "parakeet", ["DFlash2", "NVFP4"],
    )).toBe("Use DFlash2 for this project. Test NVFP4 as well.");
  });
  it("keeps ambiguous letters, different versions, and ordinary conjunctions", () => {
    expect(normalizeTranscript("Test N P F P 4.", "parakeet", ["NVFP4", "NBFP4"])).toBe("Test NPFP 4.");
    expect(normalizeTranscript("Test N P F P 5.", "parakeet", ["NVFP4"])).toBe("Test NPFP 5.");
    expect(normalizeTranscript("Test and VFP4.", "parakeet", ["NVFP4"])).toBe("Test and VFP4.");
  });
});
