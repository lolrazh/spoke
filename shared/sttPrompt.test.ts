import { describe, expect, it } from "vitest";
import { buildSTTPrompt, DEFAULT_STT_PROMPT } from "./sttPrompt";

describe("buildSTTPrompt", () => {
  it("returns the default prompt when no options are given", () => {
    expect(buildSTTPrompt()).toBe(DEFAULT_STT_PROMPT);
    expect(buildSTTPrompt({})).toBe(DEFAULT_STT_PROMPT);
  });

  it("appends identity name tokens split on whitespace", () => {
    expect(
      buildSTTPrompt({ identity: { name: "Sandeep Rajkumar" } }),
    ).toBe(`${DEFAULT_STT_PROMPT}, Sandeep, Rajkumar`);
  });

  it("appends identity email", () => {
    expect(
      buildSTTPrompt({ identity: { email: "sandeep@spoke.so" } }),
    ).toBe(`${DEFAULT_STT_PROMPT}, sandeep@spoke.so`);
  });

  it("appends extra vocabulary tokens (e.g. OCR words)", () => {
    expect(
      buildSTTPrompt({ extraVocab: ["Kubernetes", "Terraform"] }),
    ).toBe(`${DEFAULT_STT_PROMPT}, Kubernetes, Terraform`);
  });

  it("dedupes tokens already present in the base prompt (case-insensitive)", () => {
    expect(buildSTTPrompt({ extraVocab: ["spoke", "Terraform"] })).toBe(
      `${DEFAULT_STT_PROMPT}, Terraform`,
    );
  });

  it("dedupes repeated tokens within extra vocab, case-insensitively", () => {
    expect(
      buildSTTPrompt({
        extraVocab: ["Terraform", "terraform", "Terraform"],
      }),
    ).toBe(`${DEFAULT_STT_PROMPT}, Terraform`);
  });

  it("ignores empty/null/whitespace-only tokens", () => {
    expect(
      buildSTTPrompt({ extraVocab: [null, undefined, "  ", "Terraform"] }),
    ).toBe(`${DEFAULT_STT_PROMPT}, Terraform`);
  });

  it("strips tags and delimiter characters from tokens", () => {
    expect(buildSTTPrompt({ extraVocab: ["Foo<script>Bar,Baz:Qux"] })).toBe(
      `${DEFAULT_STT_PROMPT}, Foo Bar Baz Qux`,
    );
  });

  it("returns the base prompt unchanged when nothing new survives filtering", () => {
    expect(buildSTTPrompt({ extraVocab: ["spoke"] })).toBe(
      DEFAULT_STT_PROMPT,
    );
  });

  it("caps the overall prompt length, dropping lowest-priority tokens", () => {
    const extraVocab = Array.from({ length: 60 }, (_, i) => `Vocabword${i}`);
    const result = buildSTTPrompt({
      identity: { name: "Sandeep Rajkumar" },
      extraVocab,
    });

    expect(result.length).toBeLessThanOrEqual(400);
    // Identity tokens (higher priority) must survive the cap.
    expect(result).toContain("Sandeep");
    expect(result).toContain("Rajkumar");
    // Not every low-priority extra vocab token can fit under the cap.
    expect(result).not.toContain("Vocabword59");
  });

  it("respects a custom base prompt", () => {
    expect(
      buildSTTPrompt({
        basePrompt: "Vocabulary: Foo, Bar",
        extraVocab: ["Baz"],
      }),
    ).toBe("Vocabulary: Foo, Bar, Baz");
  });
});
