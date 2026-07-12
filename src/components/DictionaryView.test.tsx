import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DictionaryView from "./DictionaryView";

vi.mock("./icons/SfIcon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-testid={`sf-icon-${name}`} />
  ),
}));

function mockElectron(initial: string[]) {
  let current = [...initial];
  const addVocabularyEntry = vi.fn(async (value: string) => {
    const trimmed = value.trim();
    if (
      trimmed &&
      !current.some((word) => word.toLowerCase() === trimmed.toLowerCase())
    ) {
      current = [...current, trimmed];
    }
    return { ok: true, dictionary: [...current] };
  });
  const updateVocabularyEntry = vi.fn(
    async (currentValue: string, nextValue: string) => {
      const index = current.findIndex(
        (word) => word.toLowerCase() === currentValue.toLowerCase(),
      );
      if (index !== -1) {
        current = [...current];
        current[index] = nextValue.trim();
      }
      return { ok: true, dictionary: [...current] };
    },
  );
  const removeVocabularyEntry = vi.fn(async (value: string) => {
    current = current.filter(
      (word) => word.toLowerCase() !== value.toLowerCase(),
    );
    return { ok: true, dictionary: [...current] };
  });
  (window as any).electron = {
    getVocabularyDictionary: vi.fn(async () => ({ dictionary: current })),
    addVocabularyEntry,
    updateVocabularyEntry,
    removeVocabularyEntry,
  };
  return { addVocabularyEntry, updateVocabularyEntry, removeVocabularyEntry };
}

describe("DictionaryView", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the words from the dictionary", async () => {
    mockElectron(["Anthropic", "Kubernetes"]);
    render(<DictionaryView />);
    expect(await screen.findByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("Kubernetes")).toBeTruthy();
  });

  it("adds through an atomic command and applies the canonical response", async () => {
    const { addVocabularyEntry } = mockElectron(["Anthropic"]);
    render(<DictionaryView />);
    await screen.findByText("Anthropic");

    const input = screen.getByLabelText("Add a word");
    fireEvent.change(input, { target: { value: "parakeet holdings" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(addVocabularyEntry).toHaveBeenCalledWith("parakeet holdings"),
    );
    expect(await screen.findByText("parakeet holdings")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("keeps intentional casing on add", async () => {
    const { addVocabularyEntry } = mockElectron([]);
    render(<DictionaryView />);
    const input = screen.getByLabelText("Add a word");
    fireEvent.change(input, { target: { value: "iPhone" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(addVocabularyEntry).toHaveBeenCalledWith("iPhone"),
    );
  });

  it("removes through an atomic command", async () => {
    const { removeVocabularyEntry } = mockElectron(["Anthropic", "Kubernetes"]);
    render(<DictionaryView />);
    await screen.findByText("Anthropic");
    fireEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));
    await waitFor(() =>
      expect(removeVocabularyEntry).toHaveBeenCalledWith("Anthropic"),
    );
    expect(screen.queryByText("Anthropic")).toBeNull();
    expect(screen.getByText("Kubernetes")).toBeTruthy();
  });

  it("edits through an atomic command", async () => {
    const { updateVocabularyEntry } = mockElectron(["Anthropic", "Kubernetes"]);
    render(<DictionaryView />);
    await screen.findByText("Anthropic");
    fireEvent.click(screen.getByRole("button", { name: "Edit Anthropic" }));
    const input = screen.getByLabelText("Edit Anthropic") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Anthropic PBC" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(updateVocabularyEntry).toHaveBeenCalledWith(
        "Anthropic",
        "Anthropic PBC",
      ),
    );
    expect(await screen.findByText("Anthropic PBC")).toBeTruthy();
  });

  it("keeps rendered state when a main-process mutation fails", async () => {
    mockElectron(["Anthropic"]);
    (window as any).electron.removeVocabularyEntry = vi.fn(async () => ({
      ok: false,
      dictionary: ["Anthropic"],
      error: "disk full",
    }));
    render(<DictionaryView />);
    await screen.findByText("Anthropic");
    fireEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));
    await waitFor(() =>
      expect((window as any).electron.removeVocabularyEntry).toHaveBeenCalled(),
    );
    expect(screen.getByText("Anthropic")).toBeTruthy();
  });
});
