import { describe, it, expect } from "vitest";
import { stripHallucinations } from "./postprocess";

describe("stripHallucinations", () => {
  it('should remove "thank you for watching!" from the end (lowercase t)', () => {
    const input = "This is my actual dictation thank you for watching!";
    const expected = "This is my actual dictation";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should remove "Thank you for watching!" from the end (uppercase T)', () => {
    const input = "This is my actual dictation Thank you for watching!";
    const expected = "This is my actual dictation";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should NOT remove hallucination if it is the only text (allow retry)", () => {
    const input = "Thank you for watching!";
    const expected = "Thank you for watching!";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should trim whitespace after removing hallucination", () => {
    const input = "This is my actual dictation   thank you for watching!";
    const expected = "This is my actual dictation";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should NOT remove the phrase from the middle of text", () => {
    const input = "I want to say thank you for watching! my presentation today";
    const expected =
      "I want to say thank you for watching! my presentation today";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should NOT remove similar but different phrases", () => {
    const input = "Thank you for watching";
    const expected = "Thank you for watching";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should NOT remove the phrase without exclamation mark", () => {
    const input = "This is my text thank you for watching.";
    const expected = "This is my text thank you for watching.";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should handle empty string", () => {
    const input = "";
    const expected = "";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should handle whitespace-only string", () => {
    const input = "   ";
    const expected = "";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should preserve legitimate dictation that happens to end with the phrase", () => {
    const input =
      "I really enjoyed making this video and I wanted to say thank you for watching!";
    const expected = "I really enjoyed making this video and I wanted to say";
    expect(stripHallucinations(input)).toBe(expected);
  });

  // Amara subtitles hallucination tests
  it('should remove "Subtitles by the Amara.org community." from the end', () => {
    const input =
      "This is my actual dictation Subtitles by the Amara.org community.";
    const expected = "This is my actual dictation";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should NOT remove Amara subtitle if it is the only text (allow retry)", () => {
    const input = "Subtitles by the Amara.org community.";
    const expected = "Subtitles by the Amara.org community.";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should NOT remove Amara subtitle from the middle of text", () => {
    const input =
      "Subtitles by the Amara.org community. are helpful for accessibility";
    const expected =
      "Subtitles by the Amara.org community. are helpful for accessibility";
    expect(stripHallucinations(input)).toBe(expected);
  });

  it("should handle whitespace before Amara subtitle hallucination", () => {
    const input =
      "This is my actual dictation   Subtitles by the Amara.org community.";
    const expected = "This is my actual dictation";
    expect(stripHallucinations(input)).toBe(expected);
  });
});
