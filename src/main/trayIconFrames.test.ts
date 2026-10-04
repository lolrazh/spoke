import { describe, expect, it } from "vitest";

import {
  alphaFromBGRA,
  DOT,
  ICON_PX,
  makeSpring,
  maskToBGRA,
  morphShapes,
  MORPH_TUNING,
  rasterizeBar,
  rasterizeFailed,
  rasterizeRotated,
  rasterizeShape,
  readyShape,
  spinAngles,
  type AlphaMask,
} from "./trayIconFrames";

// A solid logo makes knockouts and fills easy to read back.
const solidLogo = (): AlphaMask => new Uint8Array(ICON_PX * ICON_PX).fill(255);
const at = (m: AlphaMask, x: number, y: number) => m[Math.floor(y) * ICON_PX + Math.floor(x)];
const same = (a: AlphaMask, b: AlphaMask) => a.length === b.length && a.every((v, i) => v === b[i]);

describe("springs", () => {
  it("samples Motion's spring with the locked head and tail tuning", () => {
    const head = makeSpring(MORPH_TUNING.headK, MORPH_TUNING.headD, MORPH_TUNING.headDelay);
    expect(head.at(50)).toBeCloseTo(0.346342, 5);
    expect(head.at(100)).toBeCloseTo(0.84339, 5);
    expect(head.at(200)).toBeCloseTo(1.127246, 5); // overshoot: the bounce
    expect(head.at(400)).toBeCloseTo(0.985482, 5);
  });

  it("holds the tail at rest until its delay has passed", () => {
    const tail = makeSpring(MORPH_TUNING.tailK, MORPH_TUNING.tailD, MORPH_TUNING.tailDelay);
    expect(tail.at(0)).toBe(0);
    expect(tail.at(50)).toBe(0);
    expect(tail.at(60)).toBeCloseTo(0.011994, 5);
    expect(tail.at(100)).toBeCloseTo(0.215261, 5);
    expect(tail.done(50)).toBe(false);
  });
});

describe("morph", () => {
  const logo = solidLogo();
  const shapes = morphShapes();
  const frames = shapes.map((s) => rasterizeShape(logo, s));

  it("starts on the full download bar and ends on the ready dot, byte for byte", () => {
    expect(same(frames[0], rasterizeBar(logo, 100))).toBe(true);
    expect(same(frames[frames.length - 1], rasterizeShape(logo, readyShape()))).toBe(true);
  });

  it("runs about half a second at 60fps", () => {
    const ms = (frames.length - 1) * (1000 / 60);
    expect(ms).toBeGreaterThan(300);
    expect(ms).toBeLessThan(1200);
  });

  it("keeps every frame inside the 32px canvas with a moving shape", () => {
    for (const s of shapes.slice(1, -1)) {
      for (const [x, y] of s.discs) {
        expect(x).toBeGreaterThan(-2);
        expect(x).toBeLessThan(34);
        expect(y).toBeGreaterThan(-2);
        expect(y).toBeLessThan(34);
      }
    }
  });
});

describe("static frames", () => {
  const logo = solidLogo();

  it("draws the empty bar as a filled cap plus a faint track", () => {
    const bar = rasterizeBar(logo, 0);
    expect(at(bar, 3, 27)).toBe(255); // left cap is always filled
    expect(at(bar, 16, 27)).toBe(Math.round(0.28 * 255)); // track
    expect(at(bar, 16, 31.5)).toBe(0); // gap below the bar
  });

  it("fills the bar with progress", () => {
    const half = rasterizeBar(logo, 50);
    expect(at(half, 12, 27)).toBe(255);
    expect(at(half, 24, 27)).toBe(Math.round(0.28 * 255));
  });

  it("cuts a gap around the ready dot", () => {
    const ready = rasterizeShape(logo, readyShape());
    expect(at(ready, DOT[0], DOT[1])).toBe(255);
    expect(at(ready, DOT[0] - 5.6, DOT[1])).toBe(0); // inside the gap ring
    expect(at(ready, 10, 20)).toBe(255); // logo untouched far away
  });

  it("draws the failed state as a hollow ring", () => {
    const failed = rasterizeFailed(logo);
    expect(at(failed, DOT[0], DOT[1])).toBe(0); // hollow centre
    expect(at(failed, DOT[0] + 3.5, DOT[1])).toBeGreaterThan(200); // ring
  });

  it("rotates the logo without changing a solid interior", () => {
    expect(spinAngles()).toHaveLength(24);
    const turned = rasterizeRotated(logo, 45);
    expect(at(turned, 16, 16)).toBe(255);
  });

  it("round-trips through BGRA", () => {
    const m = rasterizeShape(logo, readyShape());
    expect(same(alphaFromBGRA(maskToBGRA(m)), m)).toBe(true);
  });
});
