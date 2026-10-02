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
  insertViaPasteDaemon: vi.fn(async (payload: string) => {
    const original = clipboardStore.text;
    clipboardStore.text = payload;
    return {
      clipboardRead: Promise.resolve(true),
      waitForClipboardRead: async () => true,
      clipboardMs: 0.1,
      dispatchMs: 0.1,
      restoreClipboard: async () => {
        if (clipboardStore.text === payload) clipboardStore.text = original;
      },
    };
  }),
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

let clipboard: typeof import("electron")["clipboard"];
let insertViaPasteDaemon: typeof import("./pasteDaemon")["insertViaPasteDaemon"];
let insertTextAtCursor: typeof import("./pasteOrchestrator")["insertTextAtCursor"];
import { applyAutoSpace } from "./contextualDictationFormatter";
let inspectFocusedSelection: typeof import("./selectionInspect")["inspectFocusedSelection"];
let state: typeof import("./windowState")["state"];

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
  beforeEach(async () => {
    vi.resetModules();
    ({ clipboard } = await import("electron"));
    ({ insertViaPasteDaemon } = await import("./pasteDaemon"));
    ({ inspectFocusedSelection } = await import("./selectionInspect"));
    ({ state } = await import("./windowState"));
    ({ insertTextAtCursor } = await import("./pasteOrchestrator"));
    vi.useFakeTimers();
    clipboardStore.text = "";
    state.appPreferences = {};
    vi.mocked(clipboard.writeText).mockClear();
    vi.mocked(insertViaPasteDaemon).mockClear();
    vi.mocked(inspectFocusedSelection).mockClear();
    vi.mocked(inspectFocusedSelection).mockResolvedValue({
      ok: false,
      status: "unsupported",
      targetPid: 42,
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
    expect(vi.mocked(insertViaPasteDaemon).mock.calls[0][0]).toBe(
      "Hello world. ",
    );
  });

  it("pastes verbatim when auto-space is disabled", async () => {
    state.appPreferences.autoSpace = false;
    const result = await insertTextAtCursor("Hello world.");
    expect(result.success).toBe(true);
    expect(vi.mocked(insertViaPasteDaemon).mock.calls[0][0]).toBe(
      "Hello world.",
    );
  });

  it("does not add a space after a trailing newline", async () => {
    const result = await insertTextAtCursor("Hello world.\n");
    expect(result.success).toBe(true);
    expect(vi.mocked(insertViaPasteDaemon).mock.calls[0][0]).toBe(
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
      targetPid: 42,
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
    expect(vi.mocked(insertViaPasteDaemon).mock.calls[0][0]).toBe(
      " wonderful ",
    );
  });

  it("does not add a trailing space before existing punctuation", async () => {
    vi.mocked(inspectFocusedSelection).mockResolvedValue({
      ok: true,
      status: "read:ok",
      targetPid: 42,
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
    expect(vi.mocked(insertViaPasteDaemon).mock.calls[0][0]).toBe("wonderful");
  });
});
