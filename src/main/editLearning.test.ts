import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), send: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }] } }));
vi.mock("./preferences", () => ({ saveAppPreferences: mocks.save }));
import { state } from "./windowState";
import { removeVocabularyEntry } from "./vocabularyService";

describe("local edit learning", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.save.mockReturnValue(true); state.appPreferences = {}; });
  const event = (id: string) => ({ id, startedAt: Date.now(), verified: true, before: "Ask Prianka tomorrow.", after: "Ask Priyanka tomorrow.", names: ["Priyanka"] });
  async function setup() {
    const owner = (await import("./windowState")).state;
    owner.appPreferences = {};
    return { owner, ...(await import("./editLearning")) };
  }
  it("requires two different verified insertions and persists only the word pair", async () => {
    const { owner, receiveVerifiedEdit: receive } = await setup();
    receive(event("1")); receive(event("1"));
    expect(mocks.save).not.toHaveBeenCalled();
    receive(event("2"));
    expect(owner.appPreferences.vocabularyDictionary).toEqual(["Priyanka"]);
    expect(mocks.save).toHaveBeenCalledOnce();
    const saved = JSON.stringify(mocks.save.mock.calls[0][0]);
    expect(saved).not.toContain("tomorrow");
    expect(mocks.send).toHaveBeenCalledWith("vocabulary:changed");
  });
  it("learns the full DFlash2 spelling only after two distinct verified corrections", async () => {
    const { owner, receiveVerifiedEdit: receive } = await setup();
    const numbered = (id: string) => ({ ...event(id), before: "Use D flash two.", after: "Use DFlash2.", names: ["DFlash2"] });
    receive(numbered("1")); receive(numbered("1"));
    expect(mocks.save).not.toHaveBeenCalled();
    receive(numbered("2"));
    expect(owner.appPreferences.vocabularyDictionary).toEqual(["DFlash2"]);
    expect(owner.appPreferences.learnedWords).toEqual([expect.objectContaining({ from: "D flash two", to: "DFlash2" })]);
  });
  it("rejects unverified, cancelled, disabled, and duplicate observations", async () => {
    const { owner, receiveVerifiedEdit: receive, invalidateEditLearning } = await setup();
    receive({ ...event("1"), verified: false });
    receive(event("2"));
    invalidateEditLearning();
    receive({ ...event("3"), startedAt: Date.now() - 100 });
    owner.appPreferences.learnFromEdits = false;
    receive({ ...event("4"), startedAt: Date.now() + 1 });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("leaves dictionary and provenance unchanged if the save fails", async () => {
    const { owner, receiveVerifiedEdit: receive } = await setup();
    mocks.save.mockReturnValue(false);
    receive(event("1")); receive(event("2"));
    expect(owner.appPreferences.vocabularyDictionary).toBeUndefined();
    expect(owner.appPreferences.learnedWords).toBeUndefined();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not relearn a removed name", async () => {
    const { owner, receiveVerifiedEdit: receive } = await setup();
    receive(event("1")); receive(event("2"));
    const { removeVocabularyEntry: remove } = await import("./vocabularyService");
    remove("Priyanka");
    receive(event("3")); receive(event("4"));
    expect(owner.appPreferences.vocabularyDictionary).toEqual([]);
    expect(owner.appPreferences.learnedWords).toEqual([]);
    expect(owner.appPreferences.ignoredLearnedWords).toEqual(["priyanka"]);
  });
});
