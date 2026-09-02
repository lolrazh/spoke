import { describe, expect, it } from "vitest";
import { normalizeParakeetTranscript } from "./parakeetTranscriptNormalizer";

describe("main/parakeetTranscriptNormalizer", () => {
  it("removes standalone hesitation fillers and restores sentence casing", () => {
    expect(
      normalizeParakeetTranscript("um i think, uh, this is ready. ah we can ship it"),
    ).toBe("I think, this is ready. We can ship it");
  });

  it("removes punctuation stranded by filler removal", () => {
    expect(normalizeParakeetTranscript("hello. um, world")).toBe(
      "Hello. World",
    );
    expect(normalizeParakeetTranscript("hello, uh. world")).toBe(
      "Hello. World",
    );
  });

  it("preserves fillers when the speaker refers to them literally", () => {
    expect(normalizeParakeetTranscript('type "um" in the field')).toBe(
      'Type "um" in the field',
    );
    expect(normalizeParakeetTranscript("the word uh is present")).toBe(
      "The word uh is present",
    );
    expect(normalizeParakeetTranscript("say ah out loud")).toBe(
      "Say ah out loud",
    );
  });

  it("preserves meaningful uppercase and hyphenated forms", () => {
    expect(normalizeParakeetTranscript("visit the ER after the uh-oh moment")).toBe(
      "Visit the ER after the uh-oh moment",
    );
  });

  it("normalizes spoken and digit clock times", () => {
    expect(normalizeParakeetTranscript("meet me at five thirty a m")).toBe(
      "Meet me at 5:30 AM",
    );
    expect(normalizeParakeetTranscript("try again at twelve oh five p.m.")).toBe(
      "Try again at 12:05 PM.",
    );
    expect(normalizeParakeetTranscript("the alarm is for 7 05 a m")).toBe(
      "The alarm is for 7:05 AM",
    );
  });

  it("does not rewrite an invalid clock time", () => {
    expect(normalizeParakeetTranscript("the code is thirteen sixty a m")).toBe(
      "The code is thirteen sixty a m",
    );
  });

  it("normalizes storage sizes and percentages", () => {
    expect(
      normalizeParakeetTranscript(
        "the package is four hundred sixty four megabytes and progress is ninety percent",
      ),
    ).toBe("The package is 464 MB and progress is 90%");
    expect(
      normalizeParakeetTranscript(
        "so the file should be around like two hundred and thirty seven MB",
      ),
    ).toBe("So the file should be around like 237 MB");
  });

  it("normalizes a spoken version number", () => {
    expect(normalizeParakeetTranscript("install version two point five")).toBe(
      "Install version 2.5",
    );
  });

  it("capitalizes each explicit sentence without title-casing the rest", () => {
    expect(
      normalizeParakeetTranscript("everything starts lowercase. proper nouns need the dictionary"),
    ).toBe("Everything starts lowercase. Proper nouns need the dictionary");
  });

  it("does not invent terminal punctuation", () => {
    expect(normalizeParakeetTranscript("this is a fragment")).toBe(
      "This is a fragment",
    );
  });

  it("leaves empty and whitespace-only input unchanged", () => {
    expect(normalizeParakeetTranscript("")).toBe("");
    expect(normalizeParakeetTranscript("   ")).toBe("   ");
  });
});
