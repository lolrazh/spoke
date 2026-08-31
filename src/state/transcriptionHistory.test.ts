import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptionHistoryPage, TranscriptionItem } from "../types/shared";

const initialItems: TranscriptionItem[] = Array.from(
  { length: 50 },
  (_, index) => ({
    id: `item-${index}`,
    text: `text ${index}`,
    timestamp: 1000 + index,
    mode: "dictation" as const,
  }),
);

async function loadHistoryModule() {
  vi.resetModules();
  return import("./transcriptionHistory");
}

describe("transcription history paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as { transcriptions?: unknown }).transcriptions;
  });

  it("loads the first page instead of the full history", async () => {
    const getPage = vi.fn(async () => ({
      items: initialItems,
      hasMore: true,
    } satisfies TranscriptionHistoryPage));
    window.transcriptions = {
      getPage,
    } as unknown as typeof window.transcriptions;

    const history = await loadHistoryModule();
    await history.initTranscriptionHistory();

    expect(getPage).toHaveBeenCalledOnce();
    expect(getPage).toHaveBeenCalledWith(0, 50);
    expect(history.getTranscriptionHistory()).toBe(initialItems);
    expect(history.hasMoreTranscriptionHistory()).toBe(true);
  });

  it("shares an in-flight next-page request", async () => {
    const nextPage: TranscriptionHistoryPage = {
      items: [
        {
          id: "item-50",
          text: "text 50",
          timestamp: 1050,
          mode: "dictation",
        },
      ],
      hasMore: false,
    };
    let resolveNext!: (page: TranscriptionHistoryPage) => void;
    const nextPagePromise = new Promise<TranscriptionHistoryPage>((resolve) => {
      resolveNext = resolve;
    });
    const getPage = vi
      .fn<(_offset?: number, _limit?: number) => Promise<TranscriptionHistoryPage>>()
      .mockResolvedValueOnce({ items: initialItems, hasMore: true })
      .mockReturnValueOnce(nextPagePromise);
    window.transcriptions = {
      getPage,
    } as unknown as typeof window.transcriptions;

    const history = await loadHistoryModule();
    await history.initTranscriptionHistory();

    const firstLoad = history.loadMoreTranscriptionHistory();
    const secondLoad = history.loadMoreTranscriptionHistory();
    expect(getPage).toHaveBeenCalledTimes(2);

    resolveNext(nextPage);
    await Promise.all([firstLoad, secondLoad]);

    expect(history.getTranscriptionHistory()).toHaveLength(51);
    expect(history.hasMoreTranscriptionHistory()).toBe(false);
  });
});
