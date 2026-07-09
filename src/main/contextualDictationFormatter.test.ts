import { describe, expect, it } from "vitest";
import type { SelectionInspectSnapshot } from "../types/shared";
import { formatDictationForInsertion } from "./contextualDictationFormatter";

const CONTEXT_CHARS = 96;

function snapshot(
  before: string,
  after = "",
  selection = "",
): SelectionInspectSnapshot {
  return {
    ok: true,
    status: "read:ok",
    range: { location: before.length, length: selection.length },
    selectedText: selection || null,
    context: `${before}${selection}${after}`,
    valueLength: before.length + selection.length + after.length,
    hadSelection: selection.length > 0,
    source: selection ? "ax" : "none",
    rawOutput: "",
  };
}

function format(text: string, before: string, after = "", selection = "") {
  return formatDictationForInsertion(text, {
    autoSpace: true,
    selection: snapshot(before, after, selection),
    contextChars: CONTEXT_CHARS,
  });
}

describe("main/contextualDictationFormatter", () => {
  it("keeps the existing fallback behavior when no context is available", () => {
    expect(
      formatDictationForInsertion("Hello world.", { autoSpace: true }),
    ).toBe("Hello world. ");
  });

  it("adds a leading space and lowercases inside a sentence", () => {
    expect(format("Wonderful day", "It is a")).toBe(" wonderful day ");
  });

  it("does not add a leading space when one already exists before the caret", () => {
    expect(format("Wonderful day", "It is a ")).toBe("wonderful day ");
  });

  it("keeps capitalization after sentence punctuation", () => {
    expect(format("This is next", "It is done.")).toBe(" This is next ");
    expect(format("This is next", "It is done. ")).toBe("This is next ");
  });

  it("keeps capitalization after a newline", () => {
    expect(format("New line", "First line\n")).toBe("New line ");
  });

  it("does not add a trailing space before existing whitespace", () => {
    expect(format("Wonderful day", "It is a ", " already")).toBe(
      "wonderful day",
    );
  });

  it("does not add a trailing space before closing punctuation", () => {
    expect(format("wonderful day", "It was a ", ", truly")).toBe(
      "wonderful day",
    );
  });

  it("adds a trailing space before an existing word", () => {
    expect(format("really", "It was ", "good")).toBe("really ");
  });

  it("removes sentence punctuation when inserting before continuing text", () => {
    expect(
      format(
        "and improved.",
        "Hey, um, this is a new",
        " transcription test.",
      ),
    ).toBe(" and improved");
  });

  it("keeps sentence punctuation when there is no text before the caret", () => {
    expect(format("Hello world.", "", "Existing text")).toBe("Hello world. ");
  });

  it("keeps sentence punctuation when following text is on a new line", () => {
    expect(format("Done.", "First paragraph", "\nNext paragraph")).toBe(
      " done.",
    );
  });

  it("removes sentence punctuation and adds a trailing space when needed", () => {
    expect(format("and improved.", "This is new", "transcription")).toBe(
      " and improved ",
    );
  });

  it("keeps sentence punctuation when inserting at the end", () => {
    expect(format("and improved.", "This is new")).toBe(" and improved. ");
  });

  it("keeps protected abbreviation periods before continuing text", () => {
    expect(format("Dr.", "Ask ", "Smith")).toBe("Dr. ");
  });

  it("replaces selected text using the text around the selection", () => {
    expect(format("small", "This is ", " sentence.", "BIG")).toBe(
      "small",
    );
  });

  it("does not lowercase first-person I or acronyms", () => {
    expect(format("I agree", "and")).toBe(" I agree ");
    expect(format("NASA agrees", "and")).toBe(" NASA agrees ");
  });

  it("does not add a leading space after opening punctuation", () => {
    expect(format("Inside", "Look (")).toBe("inside ");
  });

  it("does not lowercase a dictionary word mid-sentence", () => {
    expect(
      formatDictationForInsertion("Sandheep agrees", {
        autoSpace: true,
        selection: snapshot("and"),
        contextChars: CONTEXT_CHARS,
        dictionary: ["Sandheep"],
      }),
    ).toBe(" Sandheep agrees ");
  });

  it("lowercases that same word mid-sentence when no dictionary is passed", () => {
    expect(format("Sandheep agrees", "and")).toBe(" sandheep agrees ");
  });

  it("pastes verbatim without trailing auto-space when disabled", () => {
    expect(
      formatDictationForInsertion("Hello", {
        autoSpace: false,
        selection: snapshot("Say "),
        contextChars: CONTEXT_CHARS,
      }),
    ).toBe("hello");
  });
});
