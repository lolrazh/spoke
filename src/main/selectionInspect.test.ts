import { describe, expect, it } from "vitest";
import { parseInspectOutput } from "./selectionInspect";

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("main/selectionInspect parseInspectOutput", () => {
  it("preserves the selection range when passive context excludes selected text", () => {
    const parsed = parseInspectOutput(
      "read:ok\nselectedRange:7:50000\ncontextExcludesSelection:1\ncontextB64:" +
        b64("It is a, indeed."),
    );
    expect(parsed.contextExcludesSelection).toBe(true);
    expect(parsed.range).toEqual({ location: 7, length: 50000 });
    expect(parsed.hadSelection).toBe(true);
  });

  it("parses a collapsed caret range with surrounding context", () => {
    const parsed = parseInspectOutput(
      [
        "read:ok",
        "targetPid:42",
        "selectedRange:12:0",
        "selectionSource:none",
        "selectedTextB64:",
        `contextB64:${b64("Hello there world")}`,
        "valueLength:17",
      ].join("\n"),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.targetPid).toBe(42);
    expect(parsed.range).toEqual({ location: 12, length: 0 });
    expect(parsed.context).toBe("Hello there world");
    expect(parsed.hadSelection).toBe(false);
  });
});
