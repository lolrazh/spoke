import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("lib/utils.cn", () => {
  it("merges classnames and prefers the latter utilities", () => {
    const out = cn(
      "px-2",
      "px-4",
      false && "hidden",
      "text-sm",
      undefined,
      null,
    );
    // tailwind-merge should keep only the last px-* utility
    expect(out).toBe("px-4 text-sm");
  });

  it("handles conditional and falsy values gracefully", () => {
    const out = cn("block", 0 && "hidden", null, undefined, "w-4");
    expect(out).toBe("block w-4");
  });
});
