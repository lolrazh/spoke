import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./windowState", () => ({ state: { appPreferences: { vocabularyDictionary: ["SavedName"] } } }));
vi.mock("./vocabularyService", () => ({ getVocabularyDictionary: () => ["FallbackName"] }));
import { state } from "./windowState";
import { screenContextSession } from "./screenContextSession";
import { clearContextVocabulary, contextDictionary } from "./contextVocabulary";
import { normalizeTranscript } from "./transcriptPostprocessing";

afterEach(() => {
  screenContextSession.clear();
  clearContextVocabulary();
  state.appPreferences.vocabularyDictionary = ["SavedName"];
});

describe("screen terms reach the correction dictionary", () => {
  it("uses final OCR terms after partial AX and keeps them through speech stop", () => {
    screenContextSession.begin("a");
    screenContextSession.accept("a", ["ChatGPT"]);
    contextDictionary("a");
    screenContextSession.accept("a", ["DFlash2", "NVFP4", "ChatGPT"]);
    const dictionary = contextDictionary("a");
    screenContextSession.freeze("a");
    expect(contextDictionary("a")).toBe(dictionary);
    expect(normalizeTranscript("Use D flash two. Try NBFP4 as well.", "parakeet", dictionary))
      .toBe("Use DFlash2. Try NVFP4 as well.");
    expect(state.appPreferences.vocabularyDictionary).toEqual(["SavedName"]);
  });

  it("uses saved spelling and discards temporary terms on invalidation or a new session", () => {
    state.appPreferences.vocabularyDictionary = ["DFlash2"];
    screenContextSession.begin("a");
    screenContextSession.accept("a", ["DFLASH2", "NVFP4"]);
    expect(contextDictionary("a")).toEqual(["DFlash2", "NVFP4"]);
    screenContextSession.invalidate("a");
    expect(contextDictionary("a")).toEqual(["DFlash2"]);
    screenContextSession.begin("b");
    expect(contextDictionary("a")).toEqual(["DFlash2"]);
    expect(contextDictionary("b")).toEqual(["DFlash2"]);
  });
});
