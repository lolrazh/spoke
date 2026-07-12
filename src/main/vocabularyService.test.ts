import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveAppPreferences: vi.fn() }));

vi.mock("./preferences", () => ({
  saveAppPreferences: mocks.saveAppPreferences,
}));

import { state } from "./windowState";
import {
  addVocabularyEntry,
  getVocabularyDictionary,
  removeVocabularyEntry,
  updateVocabularyEntry,
} from "./vocabularyService";

describe("main/vocabularyService", () => {
  beforeEach(() => {
    mocks.saveAppPreferences.mockReset();
    mocks.saveAppPreferences.mockReturnValue(true);
    state.appPreferences = {};
  });

  it("sanitizes malformed persisted data at the read boundary", () => {
    state.appPreferences.vocabularyDictionary = [
      "  GitHub  ",
      "github",
      "",
      42,
    ] as unknown as string[];
    expect(getVocabularyDictionary()).toEqual(["GitHub"]);
  });

  it("adds atomically while preserving user casing", () => {
    state.appPreferences.vocabularyDictionary = ["GitHub"];
    expect(addVocabularyEntry("  kubectl  ")).toEqual({
      ok: true,
      dictionary: ["GitHub", "kubectl"],
    });
    expect(state.appPreferences.vocabularyDictionary).toEqual([
      "GitHub",
      "kubectl",
    ]);
    expect(mocks.saveAppPreferences).toHaveBeenCalledOnce();
  });

  it("treats case-insensitive duplicates as a no-op", () => {
    state.appPreferences.vocabularyDictionary = ["GitHub"];
    expect(addVocabularyEntry("github")).toEqual({
      ok: true,
      dictionary: ["GitHub"],
    });
    expect(mocks.saveAppPreferences).not.toHaveBeenCalled();
  });

  it("updates one entry without allowing a collision", () => {
    state.appPreferences.vocabularyDictionary = ["GitHub", "Anthropic"];
    expect(updateVocabularyEntry("GitHub", "GitLab").dictionary).toEqual([
      "GitLab",
      "Anthropic",
    ]);
    expect(updateVocabularyEntry("GitLab", "anthropic").dictionary).toEqual([
      "GitLab",
      "Anthropic",
    ]);
  });

  it("removes case-insensitively", () => {
    state.appPreferences.vocabularyDictionary = ["GitHub", "Anthropic"];
    expect(removeVocabularyEntry("GITHUB").dictionary).toEqual(["Anthropic"]);
  });

  it("rolls main-process state back when the preference writer reports failure", () => {
    state.appPreferences.vocabularyDictionary = ["GitHub"];
    mocks.saveAppPreferences.mockReturnValueOnce(false);
    expect(addVocabularyEntry("Anthropic")).toEqual({
      ok: false,
      dictionary: ["GitHub"],
      error: "Failed to save vocabulary preferences",
    });
    expect(state.appPreferences.vocabularyDictionary).toEqual(["GitHub"]);
  });
});
