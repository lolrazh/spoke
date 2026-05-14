import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTranscription } from "./useTranscription";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock APIs
vi.mock("../utils/audioFeedback", () => ({
  playToggleOff: vi.fn(),
}));

vi.mock("../utils/audioDecoder", () => ({
  decodeToPcm16: vi.fn(() => Promise.resolve(new Int16Array([1, 2, 3, 4]))),
}));

vi.mock("../state/transcriptionHistory", () => ({
  addTranscription: vi.fn(() => Promise.resolve()),
}));

// Mock MediaRecorder
class MockMediaRecorder {
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(stream: MediaStream, options?: any) {
    this.mimeType = options?.mimeType || "audio/webm";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    // Simulate stop event with audio blob
    setTimeout(() => {
      if (this.onstop) {
        this.onstop();
      }
    }, 0);
  }

  static isTypeSupported(type: string) {
    return type.includes("webm");
  }
}

// @ts-ignore
global.MediaRecorder = MockMediaRecorder;

// Mock AudioContext
class MockAudioContext {
  createMediaStreamSource() {
    return {
      connect: vi.fn(),
    };
  }

  createAnalyser() {
    return {
      fftSize: 256,
      frequencyBinCount: 128,
      smoothingTimeConstant: 0.8,
      getByteFrequencyData: vi.fn(),
      connect: vi.fn(),
    };
  }

  close() {
    return Promise.resolve();
  }
}

// @ts-ignore
global.AudioContext = MockAudioContext;

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
    transcribeLocal: vi.fn(() => Promise.resolve({ text: "", metrics: {} })),
  },
  writable: true,
});

describe("useTranscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    (window.stt.getPreferredProvider as any).mockResolvedValue("local-stt");
    (window.stt.transcribeLocal as any).mockResolvedValue({
      text: "",
      metrics: {},
    });
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
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should cancel recording", async () => {
    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(result.current.recording).toBe(true);

    await act(async () => {
      result.current.cancel();
    });

    expect(result.current.recording).toBe(false);
    expect(result.current.text).toBe("");
  });
});
