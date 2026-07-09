import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import VocabularySettings from "./VocabularySettings";

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

describe("VocabularySettings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the words from the dictionary", async () => {
    mockElectron(["Anthropic", "Kubernetes"]);
    render(<VocabularySettings />);
    expect(await screen.findByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("Kubernetes")).toBeTruthy();
  });

  it("adds a word on Enter, persisting the full appended list", async () => {
    const { setVocabularyDictionary } = mockElectron(["Anthropic"]);
    render(<VocabularySettings />);
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

  it("ignores an empty submit and a case-insensitive duplicate", async () => {
    const { setVocabularyDictionary } = mockElectron(["Anthropic"]);
    render(<VocabularySettings />);
    await screen.findByText("Anthropic");

    const input = screen.getByLabelText("Add a word");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "  anthropic  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(setVocabularyDictionary).not.toHaveBeenCalled();
  });

  it("removes a word via its trash action, persisting the filtered list", async () => {
    const { setVocabularyDictionary } = mockElectron(["Anthropic", "Kubernetes"]);
    render(<VocabularySettings />);
    await screen.findByText("Anthropic");

    fireEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));

    await waitFor(() =>
      expect(setVocabularyDictionary).toHaveBeenCalledWith(["Kubernetes"]),
    );
  });
});
