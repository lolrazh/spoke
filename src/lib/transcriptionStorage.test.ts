/**
 * Transcription Storage Tests
 *
 * Covers the bounded, cache-backed history store: the cap is enforced on save,
 * legacy oversized files are truncated once on first read, and reads are served
 * from the validated in-memory cache without re-reading or re-validating the
 * whole file. The file system is mocked with an in-memory backing array.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_TRANSCRIPTION_HISTORY } from "../types/shared";
import type { TranscriptionItem } from "../types/shared";

// ── Mock the JSON file with an in-memory backing array ─────────────────

const mocks = vi.hoisted(() => {
  const fileState: { transcriptions: unknown[] } = { transcriptions: [] };
  return {
    fileState,
    getPath: vi.fn(() => "/test-user-data"),
    readFileSync: vi.fn(() =>
      JSON.stringify({ transcriptions: fileState.transcriptions }),
    ),
    writeFileSync: vi.fn((_path: string, raw: string) => {
      fileState.transcriptions = JSON.parse(raw).transcriptions;
    }),
    mkdirSync: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: { getPath: mocks.getPath },
}));

vi.mock("node:fs", () => ({
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
  mkdirSync: mocks.mkdirSync,
}));

function makeItems(count: number): TranscriptionItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    text: `text ${i}`,
    timestamp: 1000 + i,
    mode: "dictation" as const,
  }));
}

// Fresh module instance (and fresh cache) seeded from the given store contents.
async function loadModuleWith(transcriptions: unknown[]) {
  mocks.fileState.transcriptions = transcriptions;
  mocks.readFileSync.mockClear();
  mocks.writeFileSync.mockClear();
  mocks.mkdirSync.mockClear();
  vi.resetModules();
  return import("./transcriptionStorage");
}

describe("transcriptionStorage", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("prunes to the cap when saving beyond MAX_TRANSCRIPTION_HISTORY", async () => {
    const { getTranscriptions, saveTranscription } = await loadModuleWith(
      makeItems(MAX_TRANSCRIPTION_HISTORY),
    );

    const saved = saveTranscription({
      text: "newest",
      timestamp: 999999,
      mode: "dictation",
    });

    const all = getTranscriptions();
    expect(all).toHaveLength(MAX_TRANSCRIPTION_HISTORY);
    expect(all[0].id).toBe(saved.id);
    expect(all[0].text).toBe("newest");
  });

  it("truncates a legacy oversized file down to the cap once on first read", async () => {
    const { getTranscriptions } = await loadModuleWith(
      makeItems(MAX_TRANSCRIPTION_HISTORY + 50),
    );

    const all = getTranscriptions();
    expect(all).toHaveLength(MAX_TRANSCRIPTION_HISTORY);
    // The most-recent-first order is preserved: the head survives, the tail is cut.
    expect(all[0].id).toBe("item-0");
    expect(all[all.length - 1].id).toBe(
      `item-${MAX_TRANSCRIPTION_HISTORY - 1}`,
    );

    // The truncation is persisted exactly once.
    expect(mocks.writeFileSync).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(
      mocks.writeFileSync.mock.calls[0][1] as string,
    ).transcriptions;
    expect(persisted).toHaveLength(MAX_TRANSCRIPTION_HISTORY);
  });

  it("serves the second read from cache without re-reading or re-validating", async () => {
    const { getTranscriptions } = await loadModuleWith(makeItems(10));

    const first = getTranscriptions();
    const second = getTranscriptions();

    // Same cached array instance handed back on both reads.
    expect(second).toBe(first);
    // The file was read exactly once.
    expect(mocks.readFileSync).toHaveBeenCalledTimes(1);
    // A clean, within-cap file is never rewritten on read.
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("drops corrupted items and persists the cleaned list once", async () => {
    const { getTranscriptions } = await loadModuleWith([
      { id: "good", text: "keep me", timestamp: 1, mode: "dictation" },
      { id: "bad", text: "", timestamp: 2, mode: "dictation" },
      { id: "also-bad", timestamp: 3, mode: "dictation" },
    ]);

    const all = getTranscriptions();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("good");
    expect(mocks.writeFileSync).toHaveBeenCalledTimes(1);
  });
});
