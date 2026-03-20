import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTranscription } from "./useTranscription";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock APIs
vi.mock("../config/api", () => ({
  getPrepareUrl: () => "http://test/prepare",
  getTranscribeUrl: () => "http://test/transcribe",
}));

vi.mock("../utils/audioFeedback", () => ({
  playToggleOff: vi.fn(),
}));

vi.mock("../utils/audioDecoder", () => ({
  decodeToPcm16: vi.fn(() => Promise.resolve(new Int16Array([1, 2, 3, 4]))),
}));

vi.mock("../state/transcriptionHistory", () => ({
  addTranscription: vi.fn(),
}));

vi.mock("../state/userIdentity", () => ({
  getUserIdentity: () => ({ name: "Test User" }),
}));

// Mock Supabase auth
vi.mock("../lib/supabaseClient", () => ({
  getAccessToken: vi.fn(() => Promise.resolve("fake-test-token")),
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
    getPreferredProvider: vi.fn(() => Promise.resolve("legacy-cloud")),
    setPreferredProvider: vi.fn(() => Promise.resolve()),
    getLocalEnabled: vi.fn(() => Promise.resolve(false)),
    transcribeLocal: vi.fn(() => Promise.resolve({ text: "", metrics: {} })),
  },
  writable: true,
});

describe("useTranscription (HTTP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    (window.stt.getPreferredProvider as any).mockResolvedValue("legacy-cloud");
    (window.stt.getLocalEnabled as any).mockResolvedValue(false);
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

  it("should start recording and call /prepare", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          prepareId: "test-prepare-id",
          ocrWords: ["test", "words"],
          quotaInfo: { wordsUsed: 0, quotaLimit: 1000 },
        }),
    });

    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(result.current.recording).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://test/prepare",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer fake-test-token",
        }),
      }),
    );
  });

  it("should handle auth errors on /prepare", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    });

    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await waitFor(() => {
      expect(result.current.authError).toBe("auth_failed");
    });
  });

  it("should handle quota exceeded on /prepare", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () =>
        Promise.resolve({
          error: "Quota exceeded",
          code: "quota_exceeded",
        }),
    });

    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await waitFor(() => {
      expect(result.current.authError).toBe("payment_required");
    });
  });

  it("should stop recording and upload to /transcribe", async () => {
    // Mock /prepare
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          prepareId: "test-id",
          ocrWords: [],
          quotaInfo: { wordsUsed: 0, quotaLimit: 1000 },
        }),
    });

    // Mock /transcribe
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          text: "Test transcription",
          mode: "dictation",
          tier: "bypass",
          traceId: "test-trace",
        }),
    });

    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    // Start recording
    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(result.current.recording).toBe(true);

    // Stop recording
    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    await waitFor(() => {
      expect(result.current.text).toBe("Test transcription");
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "http://test/transcribe",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer fake-test-token",
        }),
      }),
    );
  });

  it("should ignore duplicate stop calls in local mode", async () => {
    (window.stt.getPreferredProvider as any).mockResolvedValue("local-stt");
    (window.stt.getLocalEnabled as any).mockResolvedValue(true);
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

  it("should cancel recording", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ prepareId: "test", ocrWords: [] }),
    });

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

  it("should clear auth errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    });

    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await waitFor(() => {
      expect(result.current.authError).toBe("auth_failed");
    });

    await act(async () => {
      result.current.clearAuthError();
    });

    expect(result.current.authError).toBe(null);
  });

  it("should handle /transcribe errors", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ prepareId: "test", ocrWords: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Server error" }),
      });

    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    await waitFor(() => {
      expect(result.current.error).toContain("Transcription failed");
    });
  });

  it("should handle missing auth token", async () => {
    const { getAccessToken } = await import("../lib/supabaseClient");
    vi.mocked(getAccessToken).mockResolvedValueOnce(null);

    const { result } = renderHook(() => useTranscription());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      result.current.start();
    });

    expect(result.current.authError).toBe("not_signed_in");
    expect(result.current.recording).toBe(false);
  });
});
