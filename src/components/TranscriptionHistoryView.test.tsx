import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TranscriptionHistoryView from "./TranscriptionHistoryView";
import type { TranscriptionItem } from "../types/shared";

vi.mock("./icons/SfIcon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-testid={`sf-icon-${name}`} />
  ),
}));

const historyItems: TranscriptionItem[] = [
  {
    id: "history-1",
    text: "Copied transcript text",
    timestamp: new Date("2026-07-06T10:00:00Z").getTime(),
    mode: "dictation",
  },
];

vi.mock("../state/transcriptionHistory", () => ({
  getTranscriptionHistory: () => historyItems,
  subscribeTranscriptionHistory: (
    listener: (items: TranscriptionItem[]) => void,
  ) => {
    listener(historyItems);
    return () => {};
  },
}));

describe("TranscriptionHistoryView", () => {
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    (window as any).clipboard = {
      writeText: vi.fn(async () => ({ ok: true })),
    };
  });

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
    vi.restoreAllMocks();
  });

  it("copies history text with the browser clipboard when available", async () => {
    const browserWrite = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: browserWrite },
    });

    render(<TranscriptionHistoryView />);
    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    await waitFor(() =>
      expect(browserWrite).toHaveBeenCalledWith("Copied transcript text"),
    );
    expect(window.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("falls back to the Electron clipboard bridge when browser copy fails", async () => {
    const browserWrite = vi.fn(async () => {
      throw new Error("clipboard permission denied");
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: browserWrite },
    });

    render(<TranscriptionHistoryView />);
    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    await waitFor(() =>
      expect(window.clipboard.writeText).toHaveBeenCalledWith(
        "Copied transcript text",
      ),
    );
  });
});
