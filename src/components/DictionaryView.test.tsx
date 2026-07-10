import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DictionaryView from "./DictionaryView";

// Mock SfIcon to avoid import.meta.glob issues in tests
vi.mock("./icons/SfIcon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-testid={`sf-icon-${name}`} />
  ),
}));

function mockElectron(initial: string[]) {
  const setVocabularyDictionary = vi.fn(async () => ({ ok: true }));
  (window as any).electron = {
    getVocabularyDictionary: vi.fn(async () => ({ dictionary: initial })),
    setVocabularyDictionary,
  };
  return { setVocabularyDictionary };
}

describe("DictionaryView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the words from the dictionary", async () => {
    mockElectron(["Anthropic", "Kubernetes"]);
    render(<DictionaryView />);
    expect(await screen.findByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("Kubernetes")).toBeTruthy();
  });

  it("adds a word on Enter, persisting the full appended list and clearing the input", async () => {
    const { setVocabularyDictionary } = mockElectron(["Anthropic"]);
    render(<DictionaryView />);
    await screen.findByText("Anthropic");

    const input = screen.getByLabelText("Add a word");
    fireEvent.change(input, { target: { value: "Parakeet" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(setVocabularyDictionary).toHaveBeenCalledWith([
        "Anthropic",
        "Parakeet",
      ]),
    );
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("title-cases an all-lowercase word on add", async () => {
    const { setVocabularyDictionary } = mockElectron([]);
    render(<DictionaryView />);

    const input = screen.getByLabelText("Add a word");
    fireEvent.change(input, { target: { value: "parakeet holdings" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(setVocabularyDictionary).toHaveBeenCalledWith([
        "Parakeet Holdings",
      ]),
    );
  });

  it("keeps intentional casing on add", async () => {
    const { setVocabularyDictionary } = mockElectron([]);
    render(<DictionaryView />);

    const input = screen.getByLabelText("Add a word");
    fireEvent.change(input, { target: { value: "iPhone" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(setVocabularyDictionary).toHaveBeenCalledWith(["iPhone"]),
    );
  });

  it("stores an edit verbatim, so editing can force a lowercase entry", async () => {
    const { setVocabularyDictionary } = mockElectron(["Kubectl"]);
    render(<DictionaryView />);
    await screen.findByText("Kubectl");

    fireEvent.click(screen.getByRole("button", { name: "Edit Kubectl" }));
    const input = screen.getByLabelText("Edit Kubectl");
    fireEvent.change(input, { target: { value: "kubectl" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(setVocabularyDictionary).toHaveBeenCalledWith(["kubectl"]),
    );
  });

  it("removes against the latest list after an add (memoized rows must not act on a stale list)", async () => {
    const { setVocabularyDictionary } = mockElectron(["Anthropic"]);
    render(<DictionaryView />);
    await screen.findByText("Anthropic");

    const input = screen.getByLabelText("Add a word");
    fireEvent.change(input, { target: { value: "Parakeet" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Parakeet");

    fireEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));

    await waitFor(() =>
      expect(setVocabularyDictionary).toHaveBeenLastCalledWith(["Parakeet"]),
    );
  });

  it("rolls back the optimistic update when the write is rejected", async () => {
    mockElectron(["Anthropic"]);
    (window as any).electron.setVocabularyDictionary = vi.fn(async () => ({
      ok: false,
      error: "disk full",
    }));
    render(<DictionaryView />);
    await screen.findByText("Anthropic");

    fireEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));

    // The word must come back once the failed write reports { ok: false }.
    expect(await screen.findByText("Anthropic")).toBeTruthy();
  });

  it("ignores an empty submit and a case-insensitive duplicate", async () => {
    const { setVocabularyDictionary } = mockElectron(["Anthropic"]);
    render(<DictionaryView />);
    await screen.findByText("Anthropic");

    const input = screen.getByLabelText("Add a word");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "  anthropic  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(setVocabularyDictionary).not.toHaveBeenCalled();
  });

  it("removes a word via its trash action, persisting the filtered list", async () => {
    const { setVocabularyDictionary } = mockElectron([
      "Anthropic",
      "Kubernetes",
    ]);
    render(<DictionaryView />);
    await screen.findByText("Anthropic");

    fireEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));

    await waitFor(() =>
      expect(setVocabularyDictionary).toHaveBeenCalledWith(["Kubernetes"]),
    );
  });

  it("edits a word: reveals a pre-filled input and persists the replaced entry", async () => {
    const { setVocabularyDictionary } = mockElectron([
      "Anthropic",
      "Kubernetes",
    ]);
    render(<DictionaryView />);
    await screen.findByText("Anthropic");

    fireEvent.click(screen.getByRole("button", { name: "Edit Anthropic" }));

    const input = screen.getByLabelText("Edit Anthropic") as HTMLInputElement;
    expect(input.value).toBe("Anthropic");

    fireEvent.change(input, { target: { value: "Anthropic PBC" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(setVocabularyDictionary).toHaveBeenCalledWith([
        "Anthropic PBC",
        "Kubernetes",
      ]),
    );
  });
});
