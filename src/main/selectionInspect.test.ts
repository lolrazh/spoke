import { describe, expect, it } from "vitest";
import { parseInspectOutput } from "./selectionInspect";

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("main/selectionInspect parseInspectOutput", () => {
  it("parses a collapsed caret range with surrounding context", () => {
    const parsed = parseInspectOutput(
      [
        "read:ok",
        "selectedRange:12:0",
        "selectionSource:none",
        "selectedTextB64:",
        `contextB64:${b64("Hello there world")}`,
        "valueLength:17",
      ].join("\n"),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.range).toEqual({ location: 12, length: 0 });
    expect(parsed.context).toBe("Hello there world");
    expect(parsed.hadSelection).toBe(false);
  });
});
