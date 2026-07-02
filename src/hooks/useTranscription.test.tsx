import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTranscription } from "./useTranscription";
import {
  FakeAudioContext,
  FakeAudioWorkletNode,
} from "../test/fakes/fakeAudio";
import { trimCapturedAudioWithVad } from "../utils/vadTrimmer";
import { addTranscription } from "../state/transcriptionHistory";
import type { CapturedAudio } from "../core/transcription/capturedAudio";
import type { VadAudioResult } from "../utils/vadTrimmer";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock APIs
vi.mock("../utils/audioFeedback", () => ({
  playToggleOff: vi.fn(),
}));

vi.mock("../utils/vadTrimmer", () => ({
  prewarmVad: vi.fn(() => Promise.resolve()),
  trimCapturedAudioWithVad: vi.fn(),
}));

vi.mock("../state/transcriptionHistory", () => ({
  addTranscription: vi.fn(() => Promise.resolve()),
}));

// @ts-ignore
global.AudioContext = FakeAudioContext;
// @ts-ignore
global.AudioWorkletNode = FakeAudioWorkletNode;

// Mock navigator.mediaDevices
Object.defineProperty(navigator, "mediaDevices", {
  value: {
    getUserMedia: vi.fn(() =>
      Promise.resolve({
        getTracks: () => [
          {
            stop: vi.fn(),
            readyState: "live",
            enabled: true,
          },
        ],
        getAudioTracks: () => [
          {
            stop: vi.fn(),
            readyState: "live",
            enabled: true,
          },
        ],
      }),
    ),
  },
  writable: true,
});

// Mock window.electron and window.clipboard
Object.defineProperty(window, "electron", {
  value: {
    takeScreenshot: vi.fn(() =>
      Promise.resolve({
        success: true,
        imageBase64: "fake-screenshot-base64",
        captureTimeMs: 100,
        sizeKb: 50,
      }),
    ),
  },
  writable: true,
});

Object.defineProperty(window, "clipboard", {
  value: {
    insertText: vi.fn(() => Promise.resolve()),
  },
  writable: true,
});

Object.defineProperty(window, "stt", {
  value: {
    getPreferredProvider: vi.fn(() => Promise.resolve("local-stt")),
    setPreferredProvider: vi.fn(() => Promise.resolve()),
    getModelStatus: vi.fn(() =>
      Promise.resolve({
        state: "ready",
        family: "whisper",
        modelId: "test-model",
        displayName: "Test Model",
        version: "1.0.0",
        manifestVersion: 1,
        downloadProgress: 1,
        downloadedBytes: 1,
        totalBytes: 1,
        error: null,
      }),
    ),
    transcribeLocal: vi.fn(() => Promise.resolve({ text: "", metrics: {} })),
    enhance: vi.fn(async (payload: { text: string }) => ({
      text: payload.text,
      bypassed: true,
    })),
    extractOcr: vi.fn(async () => ({ words: [] })),
  },
  writable: true,
});

describe("useTranscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    (globalThis as any).__lastWorklet = null;
    (window.stt.getPreferredProvider as any).mockResolvedValue("local-stt");
    (window.stt.transcribeLocal as any).mockResolvedValue({
      text: "",
      metrics: {},
    });
    (window.stt.getModelStatus as any).mockResolvedValue({
      state: "ready",
      family: "whisper",
      modelId: "test-model",
      displayName: "Test Model",
      version: "1.0.0",
      manifestVersion: 1,
      downloadProgress: 1,
      downloadedBytes: 1,
      totalBytes: 1,
      error: null,
    });
    vi.mocked(trimCapturedAudioWithVad).mockImplementation(async (audio) =>
      createVadResult(audio, true),
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("should initialize in ready state", async () => {
    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.recording).toBe(false);
    expect(result.current.processing).toBe(false);
    expect(result.current.text).toBe("");
    expect(result.current.error).toBe(null);
  });

  it("should ignore duplicate stop calls in local mode", async () => {
    (window.stt.getPreferredProvider as any).mockResolvedValue("local-stt");
    (window.stt.transcribeLocal as any).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ text: "Local transcription", metrics: {} }),
            50,
          ),
        ),
    );

    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await waitFor(() => {
      expect(window.stt.getPreferredProvider).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      emitPcmFrame([1, 2, 3, 4]);
    });

    expect(result.current.recording).toBe(true);

    await act(async () => {
      result.current.stop();
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    await waitFor(() => {
      expect(result.current.text).toBe("Local transcription");
    });

    expect(window.stt.transcribeLocal).toHaveBeenCalledTimes(1);
    expect(window.electron.takeScreenshot).not.toHaveBeenCalled();
    expect(window.stt.extractOcr).not.toHaveBeenCalled();
    expect(window.stt.enhance).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resolves the stored local provider before the first start call", async () => {
    (window.stt.getPreferredProvider as any).mockResolvedValue("local-stt");
    (window.stt.transcribeLocal as any).mockResolvedValue({
      text: "Local on first start",
      metrics: {},
    });

    const { result } = renderHook(() =>
      useTranscription({ autoInitStream: false }),
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      emitPcmFrame([5, 6, 7, 8]);
    });

    expect(result.current.recording).toBe(true);

    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    await waitFor(() => {
      expect(result.current.text).toBe("Local on first start");
    });
    expect(window.stt.transcribeLocal).toHaveBeenCalled();
    expect(window.electron.takeScreenshot).not.toHaveBeenCalled();
    expect(window.stt.extractOcr).not.toHaveBeenCalled();
    expect(window.stt.enhance).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails fast before recording when the local model is not installed", async () => {
    (window.stt.getModelStatus as any).mockResolvedValue({
      state: "not_installed",
      family: null,
      modelId: null,
      displayName: null,
      version: null,
      manifestVersion: null,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      error: null,
    });

    const { result } = renderHook(() =>
      useTranscription({ autoInitStream: false }),
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(result.current.recording).toBe(false);
    expect(result.current.error).toBe(
      "Model unavailable. Open Settings to install.",
    );
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(window.stt.transcribeLocal).not.toHaveBeenCalled();

    const firstErrorId = result.current.errorId;

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(result.current.error).toBe(
      "Model unavailable. Open Settings to install.",
    );
    expect(result.current.errorId).toBeGreaterThan(firstErrorId);
  });

  it("stops after recorder startup resolves when key-up wins the startup race", async () => {
    const originalAudioContext = global.AudioContext;
    let resolveAddModule: (() => void) | null = null;

    class SlowAudioContext extends FakeAudioContext {
      audioWorklet = {
        addModule: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveAddModule = resolve;
            }),
        ),
      };
    }

    // @ts-ignore
    global.AudioContext = SlowAudioContext;
    (window.stt.transcribeLocal as any).mockResolvedValue({
      text: "Race handled",
      metrics: {},
    });

    try {
      const { result } = renderHook(() =>
        useTranscription({ autoInitStream: false }),
      );

      await waitFor(() => {
        expect(result.current.ready).toBe(true);
      });

      await act(async () => {
        void result.current.start();
      });

      await waitFor(() => {
        expect(result.current.recording).toBe(true);
      });

      await act(async () => {
        void result.current.stop();
      });

      expect(result.current.processing).toBe(true);
      expect(window.stt.transcribeLocal).not.toHaveBeenCalled();
      expect(resolveAddModule).toBeTruthy();

      resolveAddModule?.();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });

      await waitFor(() => {
        expect(result.current.processing).toBe(false);
      });

      expect(result.current.text).toBe("Race handled");
      expect(window.stt.transcribeLocal).toHaveBeenCalledTimes(1);
    } finally {
      // @ts-ignore
      global.AudioContext = originalAudioContext;
    }
  });

  it("should cancel recording", async () => {
    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      emitPcmFrame([9, 10, 11, 12]);
    });

    expect(result.current.recording).toBe(true);

    await act(async () => {
      result.current.cancel();
    });

    expect(result.current.recording).toBe(false);
    expect(result.current.text).toBe("");
  });

  it("discards an in-flight stop pipeline when cancelled mid-processing", async () => {
    let resolveTranscription:
      | ((value: { text: string; metrics: Record<string, unknown> }) => void)
      | null = null;
    (window.stt.transcribeLocal as any).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve;
        }),
    );

    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      emitPcmFrame([1, 2, 3, 4]);
    });

    expect(result.current.recording).toBe(true);

    await act(async () => {
      result.current.stop();
      // Let stop progress past post-roll and VAD into transcription
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(result.current.processing).toBe(true);
    expect(window.stt.transcribeLocal).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.cancel();
    });

    expect(result.current.processing).toBe(false);

    await act(async () => {
      resolveTranscription?.({ text: "Cancelled transcription", metrics: {} });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(result.current.text).toBe("");
    expect(vi.mocked(addTranscription)).not.toHaveBeenCalled();
    expect(window.clipboard.insertText).not.toHaveBeenCalled();
  });

  it("skips local transcription when VAD detects no speech", async () => {
    vi.mocked(trimCapturedAudioWithVad).mockImplementationOnce((audio) =>
      Promise.resolve(createVadResult(audio, false)),
    );

    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      emitPcmFrame([0, 0, 0, 0]);
    });

    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(window.stt.transcribeLocal).not.toHaveBeenCalled();
    expect(result.current.text).toBe("");
  });
});

function emitPcmFrame(samples: number[]) {
  const worklet = (globalThis as any)
    .__lastWorklet as FakeAudioWorkletNode | null;
  expect(worklet).toBeTruthy();
  worklet?.emitAudio(new Int16Array(samples));
}

function createVadResult(
  audio: CapturedAudio,
  speechDetected: boolean,
): VadAudioResult {
  return {
    audio,
    speechDetected,
    segments: speechDetected ? [{ startMs: 0, endMs: audio.durationMs }] : [],
    trimRange: {
      startSample: 0,
      endSample: audio.pcm16.length,
    },
    leadingTrimmedMs: 0,
    trailingTrimmedMs: 0,
    vadMs: 1,
  };
}
