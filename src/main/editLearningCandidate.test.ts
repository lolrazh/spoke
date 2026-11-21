import { describe, expect, it } from "vitest";
import { editLearningCandidate as candidate } from "./editLearningCandidate";

describe("verified edit candidates", () => {
  it("isolates a local, tagged name correction", () => {
    expect(candidate("Ask Prianka tomorrow.", "Ask Priyanka tomorrow.", ["Priyanka"])).toEqual({ from: "Prianka", to: "Priyanka" });
    expect(candidate("Use Typescript.", "Use TypeScript.", ["TypeScript"])).toEqual({ from: "Typescript", to: "TypeScript" });
    expect(candidate("Ask Prianka Sharma tomorrow.", "Ask Priyanka Sharma tomorrow.", ["Priyanka Sharma"])).toEqual({ from: "Prianka Sharma", to: "Priyanka Sharma" });
  });
  it("learns a verified full identifier spelling without changing its number", () => {
    expect(candidate("Use D flash two.", "Use DFlash2.", ["DFlash2"])).toEqual({ from: "D flash two", to: "DFlash2" });
    expect(candidate("Use D flash 2.", "Use DFlash2.", ["DFlash2"])).toEqual({ from: "D flash 2", to: "DFlash2" });
    expect(candidate("Use DFlash3.", "Use DFlash2.", ["DFlash2"])).toBeNull();
    expect(candidate("Use D flash three.", "Use DFlash2.", ["DFlash2"])).toBeNull();
    expect(candidate("Use D flash two.", "Use DFlash2.", [])).toBeNull();
    expect(candidate("Use twenty two.", "Use 22.", ["22"])).toBeNull();
  });
  it.each([
    ["Ask Priyanka tomorrow.", "Ask tomorrow.", ["Priyanka"]],
    ["Ask tomorrow.", "Ask Priyanka tomorrow.", ["Priyanka"]],
    ["Ask Prianka tomorrow.", "Ask Priyanka tomorrow.", []],
    ["Ask Prianka tomorrow.", "Ask Robert tomorrow.", ["Robert"]],
    ["Ask Prianka tomorrow.", "Ask Priyanka today!", ["Priyanka"]],
    ["Send there.", "Send their.", []],
    ["Meet Prianka.", "Meet Priyanka!", ["Priyanka"]],
  ])("rejects deletion, insertion, untagged text, or broad edits", (before, after, names) => {
    expect(candidate(before as string, after as string, names as string[])).toBeNull();
  });
});
