import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CHUNK_MS,
  TARGET_SAMPLE_RATE,
  SAMPLES_PER_CHUNK,
  BYTES_PER_SAMPLE,
  streamingV2Enabled,
} from "./audio";

describe("config/audio", () => {
  let originalEnv: any;
  beforeEach(() => {
    window.localStorage.clear();
    // Reset search params: stub location deterministically
    Object.defineProperty(window, "location", {
      value: { hostname: "app.spoke.so", search: "" },
      configurable: true,
    });
    // Best-effort remove env flag if any (function guards with try/catch)
    // @ts-ignore
    originalEnv = (import.meta as any).env;
    // @ts-ignore
    (import.meta as any).env = {};
  });
  afterEach(() => {
    // @ts-ignore
    (import.meta as any).env = originalEnv;
  });

  it("derives samples per chunk from rate and CHUNK_MS", () => {
    const expected = (TARGET_SAMPLE_RATE * CHUNK_MS) / 1000;
    expect(SAMPLES_PER_CHUNK).toBe(expected);
    expect(BYTES_PER_SAMPLE).toBe(2);
  });

  it("streamingV2Enabled defaults to false", () => {
    expect(streamingV2Enabled()).toBe(false);
  });

  it("streamingV2Enabled toggles via query param", () => {
    Object.defineProperty(window, "location", {
      value: { hostname: "app.spoke.so", search: "?wsV2=1" },
      configurable: true,
    });
    expect(streamingV2Enabled()).toBe(true);
  });

  it("streamingV2Enabled toggles via localStorage flag", () => {
    window.localStorage.setItem("sf.wsV2", "1");
    expect(streamingV2Enabled()).toBe(true);
  });
});
