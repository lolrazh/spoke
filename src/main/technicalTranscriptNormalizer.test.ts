import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { joinSpelledAcronyms, formatPullRequestReferences } from "./technicalTranscriptNormalizer";

describe("technical transcript normalization", () => {
  it.each([
    ["use L O D and M C P", "use LOD and MCP"],
    ["use l o d and m c p", "use LOD and MCP"],
    ["use C P U and A P I", "use CPU and API"],
    ["I M C P", "I MCP"],
    ["review p r two thirty one", "review PR two thirty one"],
    ["I a person", "I a person"],
    ["choose a b or c", "choose a b or c"],
    ["L\nO\nD", "L\nO\nD"],
    ["LOD and MCP", "LOD and MCP"],
  ])("joins letter tokens in %s", (input, expected) => {
    expect(joinSpelledAcronyms(input)).toBe(expected);
  });

  it.each([
    ["review PR 02:31", "review PR #231"],
    ["review PR 2:31", "review PR #231"],
    ["review PR 231", "review PR #231"],
    ["review PR number 231", "review PR #231"],
    ["review PR #231", "review PR #231"],
    ["review PR 12:05 and PR 7", "review PR #1205 and PR #7"],
    ["meet at 02:31", "meet at 02:31"],
    ["discuss PR at 02:31", "discuss PR at 02:31"],
    ["PR 02:31 PM", "PR 02:31 PM"],
    ["PR 231.5", "PR 231.5"],
    ["PR 02:31:45", "PR 02:31:45"],
  ])("formats references in %s", (input, expected) => {
    expect(formatPullRequestReferences(input)).toBe(expected);
  });

  const binary = path.resolve("native/bin/spoke-itn");
  const grammar = path.resolve("native/bin/itn-grammars/en-US");
  it.skipIf(process.platform !== "darwin" || !existsSync(binary) || !existsSync(grammar))(
    "repairs the reported cases through the real bundled ITN grammar",
    () => {
      const cases = [
        ["use L O D and M C P", "use LOD and MCP"],
        ["use l o d and m c p", "use LOD and MCP"],
        ["review PR two thirty one", "review PR #231"],
        ["review P R two thirty one", "review PR #231"],
        ["review p r two thirty one", "review PR #231"],
        ["review PR two hundred thirty one", "review PR #231"],
        ["review PR 231", "review PR #231"],
        ["meet me at two thirty one", "meet me at 02:31"],
      ];
      const input = Buffer.concat(cases.map(([text]) => {
        const payload = Buffer.from(joinSpelledAcronyms(text));
        const size = Buffer.alloc(4);
        size.writeUInt32LE(payload.length);
        return Buffer.concat([size, payload]);
      }));
      const output = execFileSync(binary, [grammar], { input, timeout: 5000 });
      let offset = 0;
      for (const [, expected] of cases) {
        const size = output.readUInt32LE(offset);
        offset += 4;
        const normalized = output.subarray(offset, offset + size).toString("utf8");
        offset += size;
        expect(formatPullRequestReferences(joinSpelledAcronyms(normalized))).toBe(expected);
      }
      expect(offset).toBe(output.length);
    },
  );
});
