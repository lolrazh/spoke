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

const singleItem: TranscriptionItem[] = [
  {
    id: "history-1",
    text: "Copied transcript text",
    timestamp: new Date("2026-07-06T10:00:00Z").getTime(),
    mode: "dictation",
  },
];

const mockState = vi.hoisted(() => ({
  items: [] as unknown[],
}));

vi.mock("../state/transcriptionHistory", () => ({
  getTranscriptionHistory: () => mockState.items,
  subscribeTranscriptionHistory: (
    listener: (items: TranscriptionItem[]) => void,
  ) => {
    listener(mockState.items as TranscriptionItem[]);
    return () => {};
  },
}));

describe("TranscriptionHistoryView", () => {
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );

  beforeEach(() => {
    mockState.items = singleItem;
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

  it("renders only the first page and offers to load more when the list is large", () => {
    const now = Date.now();
    mockState.items = Array.from({ length: 120 }, (_, i) => ({
      id: `bulk-${i}`,
      text: `Bulk transcript ${i}`,
      timestamp: now - i * 60_000,
      mode: "dictation" as const,
    }));

    render(<TranscriptionHistoryView />);

    // Only the first page (PAGE_SIZE = 50) of items is rendered, not all 120,
    // so the view maps and groups just the visible window.
    expect(
      screen.getAllByRole("button", { name: "Copy to clipboard" }),
    ).toHaveLength(50);
    expect(screen.getByText("Loading more...")).toBeTruthy();
  });
});
