import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ICON_PX,
  morphShapes,
  MORPH_FRAME_MS,
  rasterizeBar,
  rasterizeFailed,
  rasterizeShape,
  readyShape,
  type AlphaMask,
} from "./trayIconFrames";
import {
  createTrayIndicator,
  deriveVisual,
  MORPH_HOLD_MS,
  type IndicatorDeps,
} from "./trayIndicator";

const logo: AlphaMask = new Uint8Array(ICON_PX * ICON_PX).fill(255);
const BASE: AlphaMask = new Uint8Array(ICON_PX * ICON_PX).fill(7);
const same = (a: AlphaMask, b: AlphaMask) => a.length === b.length && a.every((v, i) => v === b[i]);
const morphMs = (morphShapes().length - 1) * MORPH_FRAME_MS;

function setup(reduced = false) {
  const shown: AlphaMask[] = [];
  const deps: IndicatorDeps<AlphaMask> = {
    baseImage: () => BASE,
    logoAlpha: () => logo,
    toImage: (m) => m,
    setImage: (img) => shown.push(img),
    prefersReducedMotion: () => reduced,
  };
  const ind = createTrayIndicator(deps);
  return { ind, shown, last: () => shown[shown.length - 1] };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("deriveVisual", () => {
  const snap = (status: string, readyToInstall = false, downloadPercent: number | null = null) => ({
    status,
    readyToInstall,
    downloadPercent,
  });

  it("maps update states to icon states", () => {
    expect(deriveVisual(snap("checking"), false)).toEqual({ kind: "idle" });
    expect(deriveVisual(snap("not-available"), false)).toEqual({ kind: "idle" });
    expect(deriveVisual(snap("downloading", false, 41.6), false)).toEqual({ kind: "download", percent: 42 });
    expect(deriveVisual(snap("downloading"), false)).toEqual({ kind: "download", percent: 0 });
    expect(deriveVisual(snap("available", true, 100), false)).toEqual({ kind: "ready" });
    expect(deriveVisual(snap("error"), false)).toEqual({ kind: "failed" });
  });

  it("keeps the dot when an install handoff fails with the update still staged", () => {
    expect(deriveVisual(snap("error", true, 100), false)).toEqual({ kind: "ready" });
  });

  it("puts the install handoff above everything", () => {
    expect(deriveVisual(snap("available", true, 100), true)).toEqual({ kind: "installing" });
  });
});

describe("tray indicator", () => {
  it("moves the bar with whole-percent progress and skips repeats", () => {
    const { ind, shown, last } = setup();
    ind.show({ kind: "download", percent: 10 });
    ind.show({ kind: "download", percent: 10 });
    ind.show({ kind: "download", percent: 11 });
    expect(shown).toHaveLength(2);
    expect(same(last(), rasterizeBar(logo, 11))).toBe(true);
    expect(ind.isAnimating()).toBe(false);
  });

  it("holds the full bar, plays the morph once, then rests on the dot", () => {
    const { ind, last } = setup();
    ind.show({ kind: "download", percent: 97 });
    ind.show({ kind: "ready" });
    expect(same(last(), rasterizeBar(logo, 100))).toBe(true);
    expect(ind.isAnimating()).toBe(true);
    vi.advanceTimersByTime(MORPH_HOLD_MS + morphMs + 50);
    expect(same(last(), rasterizeShape(logo, readyShape()))).toBe(true);
    expect(ind.isAnimating()).toBe(false);
  });

  it("shows the dot without animating when ready is the first state seen", () => {
    const { ind, shown, last } = setup();
    ind.show({ kind: "ready" });
    expect(shown).toHaveLength(1);
    expect(same(last(), rasterizeShape(logo, readyShape()))).toBe(true);
    expect(ind.isAnimating()).toBe(false);
  });

  it("cancels the morph when the state changes mid-animation", () => {
    const { ind, shown, last } = setup();
    ind.show({ kind: "download", percent: 100 });
    ind.show({ kind: "ready" });
    vi.advanceTimersByTime(MORPH_HOLD_MS + 60);
    ind.show({ kind: "failed" });
    expect(same(last(), rasterizeFailed(logo))).toBe(true);
    expect(ind.isAnimating()).toBe(false);
    const count = shown.length;
    vi.advanceTimersByTime(2000);
    expect(shown).toHaveLength(count);
  });

  it("does not restart the morph on a repeated ready update", () => {
    const { ind, last } = setup();
    ind.show({ kind: "download", percent: 100 });
    ind.show({ kind: "ready" });
    vi.advanceTimersByTime(MORPH_HOLD_MS + 100);
    ind.show({ kind: "ready" });
    vi.advanceTimersByTime(morphMs + 50);
    expect(same(last(), rasterizeShape(logo, readyShape()))).toBe(true);
  });

  it("loops the spin during install and stops when it ends", () => {
    const { ind, shown } = setup();
    ind.show({ kind: "installing" });
    expect(ind.isAnimating()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(shown.length).toBeGreaterThan(8);
    ind.show({ kind: "idle" });
    expect(ind.isAnimating()).toBe(false);
    expect(shown[shown.length - 1]).toBe(BASE);
  });

  it("skips the morph and spin with Reduce Motion on", () => {
    const { ind, last } = setup(true);
    ind.show({ kind: "download", percent: 100 });
    ind.show({ kind: "ready" });
    expect(ind.isAnimating()).toBe(false);
    expect(same(last(), rasterizeShape(logo, readyShape()))).toBe(true);
    ind.show({ kind: "installing" });
    expect(ind.isAnimating()).toBe(false);
    expect(last()).toBe(BASE);
  });

  it("clears its timer and goes quiet when disposed", () => {
    const { ind, shown } = setup();
    ind.show({ kind: "installing" });
    ind.dispose();
    expect(ind.isAnimating()).toBe(false);
    const count = shown.length;
    vi.advanceTimersByTime(1000);
    ind.show({ kind: "idle" });
    expect(shown).toHaveLength(count);
  });
});
