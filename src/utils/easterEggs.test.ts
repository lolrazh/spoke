import { describe, expect, it } from "vitest";
import { invokedBloodyMary } from "./easterEggs";

describe("invokedBloodyMary", () => {
  it("detects three case-insensitive invocations in a completed transcript", () => {
    expect(invokedBloodyMary("Bloody Mary, bloody mary. BLOODY MARY!")).toBe(
      true,
    );
  });

  it("does not trigger before the third invocation", () => {
    expect(invokedBloodyMary("Bloody Mary, Bloody Mary")).toBe(false);
  });

  it("only counts the complete phrase", () => {
    expect(invokedBloodyMary("Bloody Maryland, Bloody Mary, Bloody Mary")).toBe(
      false,
    );
  });
});
