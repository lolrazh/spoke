import { describe, it, expect } from "vitest";
import { buildSTTPrompt, DEFAULT_STT_PROMPT } from "./prompt";

describe("services/stt/prompt", () => {
  it("returns base prompt by default", () => {
    expect(buildSTTPrompt()).toBe(DEFAULT_STT_PROMPT);
  });

  it("appends extra vocab when provided", () => {
    const p = buildSTTPrompt({ extraVocab: ["Spoke", "Groq"] });
    expect(p).toBe("Your vocabulary includes: Spoke, Groq");
  });

  it("appends identity tokens when available (splits name into separate tokens)", () => {
    const p = buildSTTPrompt({
      identity: { name: "Taylor Swift", email: "taylor@example.com" },
    });
    expect(p).toBe(
      "Your vocabulary includes: Spoke, Taylor, Swift, taylor@example.com",
    );
  });

  it("splits names with three or more parts into separate tokens", () => {
    const p = buildSTTPrompt({
      identity: { name: "John Doe Smith", email: "john@example.com" },
    });
    expect(p).toBe(
      "Your vocabulary includes: Spoke, John, Doe, Smith, john@example.com",
    );
  });

  it("dedupes tokens already present in base prompt", () => {
    const p = buildSTTPrompt({
      basePrompt: "Your vocabulary includes: Spoke",
      identity: { name: "Spoke" },
    });
    expect(p).toBe("Your vocabulary includes: Spoke");
  });

  it("sanitizes identity tokens to prevent prompt injection", () => {
    const p = buildSTTPrompt({
      identity: {
        name: '<script>alert("x")</script>',
        email: "evil@example.com\u0007",
      },
    });
    expect(p).toBe(
      'Your vocabulary includes: Spoke, alert("x"), evil@example.com',
    );
  });

  it("appends OCR words with deduplication", () => {
    const p = buildSTTPrompt({
      identity: { name: "John Doe" },
      ocrWords: ["Notion", "GitHub", "John", "Spoke"],
    });
    expect(p).toBe(
      "Your vocabulary includes: Spoke, John, Doe, Notion, GitHub",
    );
  });
});
