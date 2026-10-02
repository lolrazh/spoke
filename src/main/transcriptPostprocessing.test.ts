import { describe, expect, it, vi } from "vitest";
import corpus from "../../scripts/postprocessing-corpus.json";
import {
  normalizeTranscript,
  prepareTranscriptPostprocessing,
} from "./transcriptPostprocessing";

const dictionary = [
  "Sandheep",
  "Qwen",
  "AutoCAD",
  "Vercel",
  "skeumorphic",
  "GitHub",
];

describe("final transcript post-processing", () => {
  it.each(corpus)(
    "preserves the complete expected output for $name",
    ({ text, expected }) => {
      expect(normalizeTranscript(text, "parakeet", dictionary)).toBe(expected);
    },
  );

  it("prepares without changing later output or the vocabulary", () => {
    const frozen = Object.freeze([...dictionary]);
    prepareTranscriptPostprocessing(frozen);
    expect(normalizeTranscript(corpus[1].text, "parakeet", frozen)).toBe(
      corpus[1].expected,
    );
    expect(frozen).toEqual(dictionary);
  });

  it("keeps Whisper numeric text intact", () => {
    expect(
      normalizeTranscript(
        "meet at two thirty one, version two point five",
        "whisper",
        [],
      ),
    ).toBe("meet at two thirty one, version two point five");
  });

  it("returns normalized text if the dictionary is corrupt", () => {
    expect(
      normalizeTranscript(
        "review P R two thirty one",
        "parakeet",
        null as unknown as string[],
      ),
    ).toBe("Review PR #231");
  });

  it("keeps the best text if dictionary correction throws", () => {
    const bad = new Proxy(["Sandheep"], {
      get(target, property) {
        if (property === Symbol.iterator)
          throw new Error("dictionary unavailable");
        return Reflect.get(target, property);
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      normalizeTranscript("review P R two thirty one", "parakeet", bad),
    ).toBe("Review PR #231");
    expect(warn).toHaveBeenCalledWith(
      "[STT] Dictionary correction failed:",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
