import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const clipboardStore = { text: "" };

vi.mock("electron", () => ({
  clipboard: {
    readText: vi.fn(() => clipboardStore.text),
    writeText: vi.fn((text: string) => {
      clipboardStore.text = text;
    }),
  },
}));

vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(() => true) },
}));

vi.mock("./helperPaths", () => ({
  getHelperPath: vi.fn(() => "/mock/spoke-helper"),
}));

vi.mock("./helperProcess", () => ({
  spawnHelper: vi.fn(),
}));

vi.mock("./pasteDaemon", () => ({
  pasteViaDaemon: vi.fn(async () => true),
}));

vi.mock("./selectionInspect", () => ({
  inspectFocusedSelection: vi.fn(async () => ({
    ok: false,
    status: "unsupported",
    range: null,
    selectedText: null,
    context: null,
    valueLength: null,
    hadSelection: false,
    source: "none",
    rawOutput: "",
  })),
}));

vi.mock("./windowState", () => ({
  state: {
    appPreferences: {},
    lastTranscript: "",
    mainWindow: null,
  },
}));

import { clipboard } from "electron";
import { applyAutoSpace, insertTextAtCursor } from "./pasteOrchestrator";
import { inspectFocusedSelection } from "./selectionInspect";
import { state } from "./windowState";

describe("main/pasteOrchestrator applyAutoSpace", () => {
  it("appends a single trailing space when enabled", () => {
    expect(applyAutoSpace("Hello world.", true)).toBe("Hello world. ");
  });

  it("leaves text untouched when disabled", () => {
    expect(applyAutoSpace("Hello world.", false)).toBe("Hello world.");
  });

  it("never stacks onto existing trailing whitespace", () => {
    expect(applyAutoSpace("Hello world. ", true)).toBe("Hello world. ");
    expect(applyAutoSpace("Hello world.\n", true)).toBe("Hello world.\n");
  });

  it("leaves empty text empty", () => {
    expect(applyAutoSpace("", true)).toBe("");
  });
});

describe("main/pasteOrchestrator insertTextAtCursor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboardStore.text = "";
    state.appPreferences = {};
    vi.mocked(clipboard.writeText).mockClear();
    vi.mocked(inspectFocusedSelection).mockResolvedValue({
      ok: false,
      status: "unsupported",
      range: null,
      selectedText: null,
      context: null,
      valueLength: null,
      hadSelection: false,
      source: "none",
      rawOutput: "",
    });
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("pastes with a trailing space by default", async () => {
    const result = await insertTextAtCursor("Hello world.");
    expect(result.success).toBe(true);
    expect(vi.mocked(clipboard.writeText).mock.calls[0][0]).toBe(
      "Hello world. ",
    );
  });

  it("pastes verbatim when auto-space is disabled", async () => {
    state.appPreferences.autoSpace = false;
    const result = await insertTextAtCursor("Hello world.");
    expect(result.success).toBe(true);
    expect(vi.mocked(clipboard.writeText).mock.calls[0][0]).toBe(
      "Hello world.",
    );
  });

  it("does not add a space after a trailing newline", async () => {
    const result = await insertTextAtCursor("Hello world.\n");
    expect(result.success).toBe(true);
    expect(vi.mocked(clipboard.writeText).mock.calls[0][0]).toBe(
      "Hello world.\n",
    );
  });

  it("restores the original clipboard against the spaced payload", async () => {
    clipboardStore.text = "previous contents";
    await insertTextAtCursor("Hello world.");
    expect(clipboardStore.text).toBe("Hello world. ");
    vi.runAllTimers();
    expect(clipboardStore.text).toBe("previous contents");
  });

  it("uses focused text context to format an insertion inside a sentence", async () => {
    vi.mocked(inspectFocusedSelection).mockResolvedValue({
      ok: true,
      status: "read:ok",
      range: { location: "It was".length, length: 0 },
      selectedText: null,
      context: "It was",
      valueLength: "It was".length,
      hadSelection: false,
      source: "none",
      rawOutput: "",
    });

    const result = await insertTextAtCursor("Wonderful");
    expect(result.success).toBe(true);
    expect(vi.mocked(clipboard.writeText).mock.calls[0][0]).toBe(
      " wonderful ",
    );
  });

  it("does not add a trailing space before existing punctuation", async () => {
    vi.mocked(inspectFocusedSelection).mockResolvedValue({
      ok: true,
      status: "read:ok",
      range: { location: "It was ".length, length: 0 },
      selectedText: null,
      context: "It was , truly",
      valueLength: "It was , truly".length,
      hadSelection: false,
      source: "none",
      rawOutput: "",
    });

    const result = await insertTextAtCursor("Wonderful");
    expect(result.success).toBe(true);
    expect(vi.mocked(clipboard.writeText).mock.calls[0][0]).toBe("wonderful");
  });
});
