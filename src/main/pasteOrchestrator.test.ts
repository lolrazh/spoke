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

import { clipboard } from "electron";
import { insertViaPasteDaemon } from "./pasteDaemon";
import { insertTextAtCursor } from "./pasteOrchestrator";
import { applyAutoSpace } from "./contextualDictationFormatter";
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
    vi.mocked(insertViaPasteDaemon).mockClear();
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

  it.each(["read:err:no-focus", "read:err:no-app"])(
    "pastes with a known app even when context inspection reports %s",
    async (status) => {
      vi.mocked(inspectFocusedSelection).mockResolvedValue({
        ok: false,
        status,
        targetPid: 42,
        range: null,
        selectedText: null,
        context: null,
        valueLength: null,
        hadSelection: false,
        source: "none",
        rawOutput: "",
      });
      const result = await insertTextAtCursor("Hello world.");
      expect(result.success).toBe(true);
      expect(insertViaPasteDaemon).toHaveBeenCalledWith("Hello world. ", 42);
    },
  );

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
  it("uses passive context reads and targets the inspected app", async () => {
    vi.mocked(inspectFocusedSelection).mockResolvedValue({
      ok: true,
      status: "read:ok",
      targetPid: 42,
      range: null,
      selectedText: null,
      context: null,
      valueLength: null,
      hadSelection: false,
      source: "none",
      rawOutput: "",
    });
    expect((await insertTextAtCursor("Hello")).success).toBe(true);
    expect(inspectFocusedSelection).toHaveBeenCalledWith({
      contextChars: 96,
      passive: true,
    });
    expect(insertViaPasteDaemon).toHaveBeenCalledWith("Hello ", 42);
  });

  it("reports a dispatch failure without retrying or restoring manual-paste text", async () => {
    vi.mocked(insertViaPasteDaemon).mockRejectedValueOnce(
      new Error("Paste target changed"),
    );
    const result = await insertTextAtCursor("Hello");
    expect(result.success).toBe(false);
    expect(insertViaPasteDaemon).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(clipboardStore.text).toBe("Hello ");
  });

  it("does not send global keys when the target app is unknown", async () => {
    vi.mocked(inspectFocusedSelection).mockResolvedValueOnce({
      ok: false,
      status: "no-app",
      range: null,
      selectedText: null,
      context: null,
      valueLength: null,
      hadSelection: false,
      source: "none",
      rawOutput: "",
    });
    expect((await insertTextAtCursor("Hello")).success).toBe(false);
    expect(insertViaPasteDaemon).not.toHaveBeenCalled();
  });

  it("restores only after a clipboard read plus the restoration delay", async () => {
    let read!: (observed: boolean) => void;
    const clipboardRead = new Promise<boolean>((resolve) => {
      read = resolve;
    });
    const restore = vi.fn(async () => undefined);
    vi.mocked(insertViaPasteDaemon).mockResolvedValueOnce({
      clipboardRead,
      restoreClipboard: restore,
      clipboardMs: 0.1,
      dispatchMs: 0.1,
    });
    expect((await insertTextAtCursor("Hello")).success).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(restore).not.toHaveBeenCalled();
    read(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(restore).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(restore).toHaveBeenCalledOnce();
  });
  it("leaves the clipboard intact when no read is observed", async () => {
    const restore = vi.fn(async () => undefined);
    vi.mocked(insertViaPasteDaemon).mockResolvedValueOnce({
      clipboardRead: Promise.resolve(false),
      restoreClipboard: restore,
      clipboardMs: 0.1,
      dispatchMs: 0.1,
    });
    const result = await insertTextAtCursor("Hello");
    expect(result).toEqual({ success: true, verified: false });
    await vi.advanceTimersByTimeAsync(3000);
    expect(restore).not.toHaveBeenCalled();
    expect(insertViaPasteDaemon).toHaveBeenCalledTimes(1);
  });

  it("serializes the entire insertion transaction", async () => {
    let release!: () => void;
    vi.mocked(insertViaPasteDaemon).mockImplementationOnce((payload) => {
      clipboardStore.text = payload;
      return new Promise((resolve) => {
        release = () =>
          resolve({
            clipboardRead: Promise.resolve(true),
            clipboardMs: 0.1,
            dispatchMs: 0.1,
            restoreClipboard: async () => undefined,
          });
      });
    });
    const first = insertTextAtCursor("First"),
      second = insertTextAtCursor("Second");
    await vi.waitFor(() =>
      expect(insertViaPasteDaemon).toHaveBeenCalledTimes(1),
    );
    expect(clipboardStore.text).toBe("First ");
    release();
    await first;
    await second;
    expect(vi.mocked(insertViaPasteDaemon).mock.calls.map((x) => x[0])).toEqual(
      ["First ", "Second "],
    );
  });
});
