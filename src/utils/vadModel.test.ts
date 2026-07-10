import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the vad-web package so resolveVadModel builds a lightweight fake
// instance instead of loading the real ONNX/WASM model. Each successful build
// increments `vadNew`, letting us observe caching vs. rebuild-after-release.
const vadNew = vi.fn();
vi.mock("@ricky0123/vad-web", () => ({
  NonRealTimeVAD: { new: (...args: unknown[]) => vadNew(...args) },
}));

import {
  invalidateVadModel,
  releaseVadModel,
  resolveVadModel,
} from "./vadModel";
import { VAD_IDLE_RELEASE_MS, VAD_INIT_TIMEOUT_MS } from "../config/vad";

describe("vadModel idle release", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vadNew.mockReset();
    vadNew.mockImplementation(async () => ({ frameProcessor: {}, run: vi.fn() }));
    // Start each test from a cold cache.
    releaseVadModel();
  });

  afterEach(() => {
    releaseVadModel();
    vi.useRealTimers();
  });

  it("builds the model once and caches it across resolves", async () => {
    await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);
    await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);

    expect(vadNew).toHaveBeenCalledTimes(1);
  });

  it("releases the cached model after the idle window, rebuilding on next use", async () => {
    await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);
    expect(vadNew).toHaveBeenCalledTimes(1);

    // No dictation for the whole idle window: the watchdog drops the cache.
    vi.advanceTimersByTime(VAD_IDLE_RELEASE_MS);

    // The first dictation after release pays a fresh model init (mitigated in
    // production by the streaming VAD's post-hoc fallback).
    await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);
    expect(vadNew).toHaveBeenCalledTimes(2);
  });

  it("resets the idle countdown on each use (never fires mid-session)", async () => {
    await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);
    vi.advanceTimersByTime(VAD_IDLE_RELEASE_MS - 1_000);

    // A fresh use (e.g. the next dictation's prewarm) re-arms the watchdog.
    await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);
    vi.advanceTimersByTime(VAD_IDLE_RELEASE_MS - 1_000);

    // Still within the restarted countdown: model is untouched, no rebuild.
    await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);
    expect(vadNew).toHaveBeenCalledTimes(1);

    // Now let a full idle window elapse and confirm it finally releases.
    vi.advanceTimersByTime(VAD_IDLE_RELEASE_MS);
    await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);
    expect(vadNew).toHaveBeenCalledTimes(2);
  });

  it("does not fire once the cache is explicitly released", async () => {
    await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);
    invalidateVadModel();
    releaseVadModel();

    // The pending timer callback re-runs releaseVadModel harmlessly; advancing
    // past the window must not throw or otherwise misbehave.
    vi.advanceTimersByTime(VAD_IDLE_RELEASE_MS * 2);

    await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);
    expect(vadNew).toHaveBeenCalledTimes(2);
  });
});
