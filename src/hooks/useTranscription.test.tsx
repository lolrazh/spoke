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
import type { StreamingVadSessionOptions } from "../utils/streamingVad";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock APIs
vi.mock("../utils/audioFeedback", () => ({
  playToggleOff: vi.fn(),
}));

vi.mock("../utils/vadTrimmer", () => ({
  trimCapturedAudioWithVad: vi.fn(),
}));

// By default the streaming VAD session reports itself as unusable, so batch
// tests exercise the fixed-post-roll + trimCapturedAudioWithVad fallback path.
// Live streaming models intentionally skip this duplicate VAD worker.
const mockCreateStreamingVadSession = vi.fn(
  (_options: StreamingVadSessionOptions) => createUnusableStreamingVadSessionFake(),
);
vi.mock("../utils/streamingVad", () => ({
  createStreamingVadSession: (options: StreamingVadSessionOptions) =>
    mockCreateStreamingVadSession(options),
}));

function createUnusableStreamingVadSessionFake() {
  return {
    isUsable: () => false,
    pushFrame: vi.fn(),
    waitForQuiet: vi.fn(async () => 0),
    finish: vi.fn(async () => null),
    dispose: vi.fn(),
  };
}

function createUsableStreamingVadSessionFake(overrides: {
  waitForQuiet?: (maxWaitMs: number) => Promise<number>;
  finish?: (audio: CapturedAudio) => Promise<VadAudioResult | null>;
} = {}) {
  return {
    isUsable: () => true,
    pushFrame: vi.fn(),
    waitForQuiet: vi.fn(overrides.waitForQuiet ?? (async () => 0)),
    finish: vi.fn(
      overrides.finish ?? (async (audio: CapturedAudio) => createVadResult(audio, true)),
    ),
    dispose: vi.fn(),
  };
}

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

Object.defineProperty(window, "notifications", {
  value: {
    send: vi.fn(),
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
    getActiveModel: vi.fn(() => Promise.resolve("test-model")),
    getModelInfos: vi.fn(() => Promise.resolve([testModelInfo()])),
    startLocalStream: vi.fn(() => Promise.resolve({ sessionId: "stream-1" })),
    pushLocalStream: vi.fn(() => Promise.resolve()),
    finishLocalStream: vi.fn(() =>
      Promise.resolve({ text: "", metrics: {} }),
    ),
    cancelLocalTranscription: vi.fn(() => Promise.resolve()),
    onLocalStreamPartial: vi.fn(() => () => undefined),
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
    (window.stt.getActiveModel as any).mockResolvedValue("test-model");
    (window.stt.getModelInfos as any).mockResolvedValue([testModelInfo()]);
    (window.stt.startLocalStream as any).mockResolvedValue({
      sessionId: "stream-1",
    });
    (window.stt.pushLocalStream as any).mockResolvedValue(undefined);
    (window.stt.finishLocalStream as any).mockResolvedValue({
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

  it("starts idle", () => {
    const { result } = renderHook(() =>
      useTranscription({ autoInitStream: false }),
    );

    expect(result.current.recording).toBe(false);
    expect(result.current.processing).toBe(false);
    expect(result.current.text).toBe("");
    expect(result.current.error).toBe(null);
  });

  it("keeps the hook return stable across unrelated renders", async () => {
    const { result, rerender } = renderHook(() =>
      useTranscription({ autoInitStream: false }),
    );

    const firstResult = result.current;
    rerender();

    expect(result.current).toBe(firstResult);
  });

  it("keeps batch results out of live text and ignores duplicate stops", async () => {
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

    await act(async () => {
      result.current.start();
      await emitPcmFrame([1, 2, 3, 4]);
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

  it("notifies after a completed Bloody Mary invocation", async () => {
    (window.stt.transcribeLocal as any).mockResolvedValue({
      text: "Bloody Mary, bloody mary, BLOODY MARY",
      metrics: {},
    });

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      result.current.start();
      await emitPcmFrame([1, 2, 3, 4]);
    });

    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    await waitFor(() => {
      expect(window.notifications.send).toHaveBeenCalledWith("Boo");
    });
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

    await act(async () => {
      result.current.start();
      await emitPcmFrame([5, 6, 7, 8]);
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

  it("cleans up recording when provider resolution rejects during stop", async () => {
    const { defaultTranscriptionSessionOrchestrator } = await import(
      "../core/transcription/defaultSessionOrchestrator"
    );
    const originalResolveProvider =
      defaultTranscriptionSessionOrchestrator.resolveProvider;
    const resolveProviderSpy = vi
      .spyOn(defaultTranscriptionSessionOrchestrator, "resolveProvider")
      .mockImplementationOnce(originalResolveProvider)
      .mockImplementationOnce(() => {
        throw new Error("Provider resolution failed");
      });
    const trackStop = vi.fn();
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValueOnce({
      getTracks: () => [{ stop: trackStop, readyState: "live" }],
      getAudioTracks: () => [{ stop: trackStop, readyState: "live" }],
    });

    try {
      const { result } = renderHook(() =>
        useTranscription({ autoInitStream: false }),
      );

      await act(async () => {
        result.current.start();
        await emitPcmFrame([1, 2, 3, 4]);
      });

      expect(result.current.recording).toBe(true);

      await act(async () => {
        await result.current.stop();
      });

      expect(result.current.recording).toBe(false);
      expect(result.current.processing).toBe(false);
      expect(result.current.error).toBe("Provider resolution failed");
      expect(trackStop).toHaveBeenCalledOnce();

      // A failed stop must not leave stopInFlightRef latched and block the
      // next dictation.
      await act(async () => {
        result.current.start();
        await emitPcmFrame([5, 6, 7, 8]);
      });
      expect(result.current.recording).toBe(true);
      act(() => result.current.cancel());
    } finally {
      resolveProviderSpy.mockRestore();
    }
  });

  it("discards pending chunk audio when provider resolution rejects during stop", async () => {
    vi.useFakeTimers();
    const { defaultTranscriptionSessionOrchestrator } = await import(
      "../core/transcription/defaultSessionOrchestrator"
    );
    const originalResolveProvider =
      defaultTranscriptionSessionOrchestrator.resolveProvider;
    const resolveProviderSpy = vi
      .spyOn(defaultTranscriptionSessionOrchestrator, "resolveProvider")
      .mockImplementationOnce(originalResolveProvider)
      .mockImplementationOnce(() => {
        throw new Error("Provider resolution failed");
      });
    let notifySpeechEnd: (() => void) | undefined;
    mockCreateStreamingVadSession.mockImplementationOnce((options) => {
      notifySpeechEnd = options.onSpeechEnd;
      return createUnusableStreamingVadSessionFake();
    });

    try {
      const { result } = renderHook(() =>
        useTranscription({ autoInitStream: false }),
      );

      await act(async () => {
        await result.current.start();
      });

      const worklet = (globalThis as any)
        .__lastWorklet as FakeAudioWorkletNode | null;
      expect(worklet).toBeTruthy();

      // Cross the forced chunk boundary, then leave enough fresh audio for a
      // delayed natural-boundary timer to dispatch if cleanup misses it.
      worklet?.emitAudio(new Int16Array(400_000));
      expect(window.stt.transcribeLocal).toHaveBeenCalledTimes(1);
      (window.stt.transcribeLocal as any).mockClear();
      worklet?.emitAudio(new Int16Array(128_000));
      expect(notifySpeechEnd).toBeTypeOf("function");
      notifySpeechEnd?.();

      await act(async () => {
        await result.current.stop();
      });

      expect(result.current.error).toBe("Provider resolution failed");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });
      expect(window.stt.transcribeLocal).not.toHaveBeenCalled();
    } finally {
      resolveProviderSpy.mockRestore();
      vi.useRealTimers();
    }
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
    const addModuleResolver: { resolve: (() => void) | null } = {
      resolve: null,
    };

    class SlowAudioContext extends FakeAudioContext {
      audioWorklet = {
        addModule: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              addModuleResolver.resolve = resolve;
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
      expect(addModuleResolver.resolve).toBeTruthy();

      addModuleResolver.resolve?.();

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

    await act(async () => {
      result.current.start();
      await emitPcmFrame([9, 10, 11, 12]);
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

    await act(async () => {
      result.current.start();
      await emitPcmFrame([1, 2, 3, 4]);
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

    await act(async () => {
      result.current.start();
      await emitPcmFrame([0, 0, 0, 0]);
    });

    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(window.stt.transcribeLocal).not.toHaveBeenCalled();
    expect(result.current.text).toBe("");
  });

  it("falls back to the fixed post-roll and post-hoc VAD when streaming VAD never becomes usable", async () => {
    (window.stt.transcribeLocal as any).mockResolvedValue({
      text: "Fallback path",
      metrics: {},
    });

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      result.current.start();
      await emitPcmFrame([1, 2, 3, 4]);
    });

    const stopStartedAt = performance.now();
    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    const elapsed = performance.now() - stopStartedAt;

    await waitFor(() => {
      expect(result.current.text).toBe("Fallback path");
    });
    expect(trimCapturedAudioWithVad).toHaveBeenCalledTimes(1);
    // Fell all the way through today's exact fixed post-roll wait (~240ms).
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  it("skips the post-roll wait and post-hoc VAD when the streaming VAD already confirmed speech ended", async () => {
    const usableSession = createUsableStreamingVadSessionFake({
      waitForQuiet: async () => 0,
    });
    mockCreateStreamingVadSession.mockReturnValueOnce(usableSession);
    (window.stt.transcribeLocal as any).mockResolvedValue({
      text: "Adaptive path",
      metrics: {},
    });

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      result.current.start();
      await emitPcmFrame([1, 2, 3, 4]);
    });

    expect(usableSession.pushFrame).toHaveBeenCalled();

    const consoleInfoSpy = vi.spyOn(console, "info");
    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    await waitFor(() => {
      expect(result.current.text).toBe("Adaptive path");
    });
    expect(usableSession.waitForQuiet).toHaveBeenCalledWith(240);
    expect(usableSession.finish).toHaveBeenCalledTimes(1);
    // The old fixed post-roll fallback never ran.
    expect(trimCapturedAudioWithVad).not.toHaveBeenCalled();
    // The latency log's post_roll_ms honestly reflects the actual
    // (near-zero) adaptive wait, not the old fixed POST_ROLL_MS.
    const latencyCall = consoleInfoSpy.mock.calls.find(
      (call) => call[0] === "[Latency]",
    );
    const payload = latencyCall?.[2]
      ? (JSON.parse(String(latencyCall[2])) as { post_roll_ms: number })
      : undefined;
    expect(payload?.post_roll_ms).toBeLessThan(50);
    consoleInfoSpy.mockRestore();
  });

  it("caps the adaptive post-roll wait at POST_ROLL_MS when the streaming VAD never settles", async () => {
    const usableSession = createUsableStreamingVadSessionFake({
      waitForQuiet: async (maxWaitMs) => maxWaitMs,
    });
    mockCreateStreamingVadSession.mockReturnValueOnce(usableSession);
    (window.stt.transcribeLocal as any).mockResolvedValue({
      text: "Capped wait",
      metrics: {},
    });

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      result.current.start();
      await emitPcmFrame([1, 2, 3, 4]);
    });

    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    await waitFor(() => {
      expect(result.current.text).toBe("Capped wait");
    });
    expect(usableSession.waitForQuiet).toHaveBeenCalledWith(240);
  });

  it("falls back to post-hoc VAD if the streaming session's finish() rejects", async () => {
    const usableSession = createUsableStreamingVadSessionFake({
      finish: async () => {
        throw new Error("VAD worker crashed during finish");
      },
    });
    mockCreateStreamingVadSession.mockReturnValueOnce(usableSession);
    (window.stt.transcribeLocal as any).mockResolvedValue({
      text: "Recovered via fallback",
      metrics: {},
    });

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      result.current.start();
      await emitPcmFrame([1, 2, 3, 4]);
    });

    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    await waitFor(() => {
      expect(result.current.text).toBe("Recovered via fallback");
    });
    expect(usableSession.finish).toHaveBeenCalledTimes(1);
    expect(trimCapturedAudioWithVad).toHaveBeenCalledTimes(1);
  });

  it("transcribes the full recording when both VAD workers fail", async () => {
    const usableSession = createUsableStreamingVadSessionFake({
      finish: async () => null,
    });
    mockCreateStreamingVadSession.mockReturnValueOnce(usableSession);
    vi.mocked(trimCapturedAudioWithVad).mockRejectedValueOnce(
      new Error("VAD worker crashed"),
    );
    (window.stt.transcribeLocal as any).mockResolvedValue({
      text: "Recovered full recording",
      metrics: {},
    });

    const { result } = renderHook(() => useTranscription());
    await act(async () => {
      result.current.start();
      await emitPcmFrame([1, 2, 3, 4]);
    });

    await act(async () => {
      result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    await waitFor(() => {
      expect(result.current.text).toBe("Recovered full recording");
    });
    expect(result.current.error).toBeNull();
    expect(trimCapturedAudioWithVad).toHaveBeenCalledTimes(1);
    expect(window.stt.transcribeLocal).toHaveBeenCalledTimes(1);
    const transcribeLocal = window.stt.transcribeLocal as ReturnType<
      typeof vi.fn
    >;
    const pcmPayload = transcribeLocal.mock.calls[0][1] as
      | ArrayBuffer
      | Uint8Array;
    const transcribedPcm =
      pcmPayload instanceof Uint8Array
        ? new Int16Array(
            pcmPayload.buffer,
            pcmPayload.byteOffset,
            pcmPayload.byteLength / Int16Array.BYTES_PER_ELEMENT,
          )
        : new Int16Array(pcmPayload);
    expect(Array.from(transcribedPcm)).toEqual([1, 2, 3, 4]);
  });

  it("disposes the streaming VAD session on cancel()", async () => {
    const usableSession = createUsableStreamingVadSessionFake();
    mockCreateStreamingVadSession.mockReturnValueOnce(usableSession);

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      result.current.start();
      await emitPcmFrame([1, 2, 3, 4]);
    });

    await act(async () => {
      result.current.cancel();
    });

    expect(usableSession.dispose).toHaveBeenCalledTimes(1);
    expect(usableSession.finish).not.toHaveBeenCalled();
  });

  it("disposes streaming VAD when cancel races with finish()", async () => {
    let resolveFinish:
      | ((result: VadAudioResult | null) => void)
      | null = null;
    const usableSession = createUsableStreamingVadSessionFake({
      finish: async () =>
        new Promise((resolve) => {
          resolveFinish = resolve;
        }),
    });
    mockCreateStreamingVadSession.mockReturnValueOnce(usableSession);

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      result.current.start();
      await emitPcmFrame([1, 2, 3, 4]);
    });

    await act(async () => {
      result.current.stop();
      await waitFor(() => {
        expect(usableSession.finish).toHaveBeenCalledTimes(1);
      });
    });

    await act(async () => {
      result.current.cancel();
    });

    expect(usableSession.dispose).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFinish?.(null);
      await Promise.resolve();
    });

    expect(trimCapturedAudioWithVad).not.toHaveBeenCalled();
    expect(window.stt.transcribeLocal).not.toHaveBeenCalled();
  });

  it("uses the bounded live path for a streaming local model", async () => {
    const stream = configureStreamingModel("hello world");

    const { result } = renderHook(() => useTranscription());
    await act(async () => result.current.start());
    expect(mockCreateStreamingVadSession).not.toHaveBeenCalled();
    await emitPcmFrame(new Array(10_240).fill(1));
    await waitFor(() =>
      expect(window.stt.pushLocalStream).toHaveBeenCalledTimes(2),
    );
    expect(
      new Int16Array(
        (window.stt.pushLocalStream as ReturnType<typeof vi.fn>).mock.calls[0][1],
      ),
    ).toHaveLength(5_120);

    await act(async () => {
      stream.emitPartial("hello");
    });
    expect(result.current.text).toBe("");
    expect(addTranscription).not.toHaveBeenCalled();
    expect(window.clipboard.insertText).not.toHaveBeenCalled();

    await act(async () => result.current.stop());
    await waitFor(() => expect(result.current.processing).toBe(false));
    expect(window.stt.finishLocalStream).toHaveBeenCalledWith("stream-1");
    expect(window.stt.transcribeLocal).not.toHaveBeenCalled();
    expect(result.current.text).toBe("hello world");
    expect(addTranscription).toHaveBeenCalledOnce();
    expect(addTranscription).toHaveBeenCalledWith("hello world", "dictation");
    expect(window.clipboard.insertText).toHaveBeenCalledOnce();
    expect(window.clipboard.insertText).toHaveBeenCalledWith("hello world");
  });

  it("finishes a live stream without starting duplicate VAD", async () => {
    configureStreamingModel("Recovered live stream");

    const { result } = renderHook(() => useTranscription());
    await act(async () => result.current.start());
    expect(mockCreateStreamingVadSession).not.toHaveBeenCalled();

    await act(async () => {
      result.current.stop();
    });

    await waitFor(() => expect(result.current.processing).toBe(false));
    expect(result.current.text).toBe("Recovered live stream");
    expect(result.current.error).toBeNull();
    expect(window.stt.finishLocalStream).toHaveBeenCalledWith("stream-1");
    expect(window.stt.cancelLocalTranscription).not.toHaveBeenCalled();
  });

  it("cancels the live stream when native audio capture fails", async () => {
    configureStreamingModel("unused");
    let emitCaptureError: ((message: string) => void) | null = null;
    const originalAudioCapture = window.audioCapture;
    window.audioCapture = {
      isAvailable: vi.fn(async () => true),
      listDevices: vi.fn(async () => []),
      start: vi.fn(async () => ({ ok: true })),
      stop: vi.fn(async () => ({ ok: true })),
      cancel: vi.fn(async () => ({ ok: true })),
      onFrame: vi.fn(() => vi.fn()),
      onStopped: vi.fn(() => vi.fn()),
      onError: vi.fn((listener) => {
        emitCaptureError = listener;
        return vi.fn();
      }),
    };

    try {
      const { result } = renderHook(() => useTranscription());
      await act(async () => result.current.start());
      expect(result.current.recording).toBe(true);

      act(() => emitCaptureError?.("microphone disconnected"));

      await waitFor(() => expect(result.current.recording).toBe(false));
      expect(result.current.error).toBe("microphone disconnected");
      expect(window.stt.cancelLocalTranscription).toHaveBeenCalledOnce();
    } finally {
      window.audioCapture = originalAudioCapture;
    }
  });

  it("clears a live hypothesis on cancel and ignores stale partials", async () => {
    const stream = configureStreamingModel("should not publish");
    const { result } = renderHook(() => useTranscription());
    await act(async () => result.current.start());

    await act(async () => stream.emitPartial("cancel me"));

    act(() => result.current.cancel());
    expect(result.current.text).toBe("");

    await act(async () => stream.emitPartial("stale words"));
    expect(addTranscription).not.toHaveBeenCalled();
    expect(window.clipboard.insertText).not.toHaveBeenCalled();
  });

  it("records while streaming startup is pending and still lets cancel win", async () => {
    let resolveStart!: (value: { sessionId: string }) => void;
    const pendingStart = new Promise<{ sessionId: string }>((resolve) => {
      resolveStart = resolve;
    });
    (window.stt.getActiveModel as any).mockResolvedValue("nemotron");
    (window.stt.getModelStatus as any).mockResolvedValue({
      state: "ready",
      family: "nemotron",
      modelId: "nemotron",
      displayName: "Nemotron",
      version: "1.0.0",
      manifestVersion: 1,
      downloadProgress: 1,
      downloadedBytes: 1,
      totalBytes: 1,
      error: null,
    });
    (window.stt.getModelInfos as any).mockResolvedValue([
      {
        modelId: "nemotron",
        family: "nemotron",
        displayName: "Nemotron",
        tagline: "Streaming",
        languageCount: 40,
        quantization: "8-bit",
        totalBytes: 1,
        isDefault: false,
        streaming: true,
        streamingChunkMs: 560,
      },
    ]);
    (window.stt.startLocalStream as any).mockReturnValue(pendingStart);

    const { result } = renderHook(() =>
      useTranscription({ autoInitStream: false }),
    );
    await act(async () => {
      await result.current.start();
      await waitFor(() =>
        expect(window.stt.startLocalStream).toHaveBeenCalledOnce(),
      );
    });

    expect(result.current.recording).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();

    act(() => result.current.cancel());
    expect(window.stt.cancelLocalTranscription).toHaveBeenCalledOnce();
    expect(result.current.recording).toBe(false);

    await act(async () => {
      resolveStart({ sessionId: "stale-stream" });
      await Promise.resolve();
    });

    expect(result.current.recording).toBe(false);
  });
});

function configureStreamingModel(finalText: string) {
  let partialListener:
    | ((payload: { sessionId: string; text: string }) => void)
    | null = null;
  (window.stt.getActiveModel as any).mockResolvedValue("nemotron");
  (window.stt.getModelStatus as any).mockResolvedValue({
    state: "ready",
    family: "nemotron",
    modelId: "nemotron",
    displayName: "Nemotron",
    version: "1.0.0",
    manifestVersion: 1,
    downloadProgress: 1,
    downloadedBytes: 1,
    totalBytes: 1,
    error: null,
  });
  (window.stt.getModelInfos as any).mockResolvedValue([
    {
      modelId: "nemotron",
      family: "nemotron",
      displayName: "Nemotron",
      tagline: "Streaming",
      languageCount: 40,
      quantization: "8-bit",
      totalBytes: 1,
      isDefault: false,
      streaming: true,
      streamingChunkMs: 560,
    },
  ]);
  (window.stt.onLocalStreamPartial as any).mockImplementation((
    listener: (payload: { sessionId: string; text: string }) => void,
  ) => {
    partialListener = listener;
    return vi.fn();
  });
  (window.stt.finishLocalStream as any).mockResolvedValue({
    text: finalText,
    metrics: { inference_ms: 1 },
  });

  return {
    emitPartial(text: string) {
      partialListener?.({ sessionId: "stream-1", text });
    },
  };
}

function testModelInfo() {
  return {
    modelId: "test-model",
    family: "whisper",
    displayName: "Test Model",
    tagline: "Test",
    languageCount: 1,
    quantization: "4-bit",
    totalBytes: 1,
    isDefault: true,
    streaming: false,
  };
}

async function emitPcmFrame(samples: number[]) {
  await waitFor(() => {
    const worklet = (globalThis as any)
      .__lastWorklet as FakeAudioWorkletNode | null;
    expect(worklet).toBeTruthy();
  });
  const worklet = (globalThis as any)
    .__lastWorklet as FakeAudioWorkletNode | null;
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
