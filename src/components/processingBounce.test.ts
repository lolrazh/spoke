import { describe, expect, it } from "vitest";
import { processingBounceFrame } from "./processingBounce";

const peak = (time: number) => {
  const heights = Array.from({ length: 18 }, (_, index) => processingBounceFrame(time, index).height);
  return heights.indexOf(Math.max(...heights));
};

describe("processing bounce", () => {
  it("returns smoothly across the bars without a jump at either end", () => {
    expect(peak(0.225)).toBe(8);
    expect(peak(0.45)).toBe(17);
    expect(peak(0.675)).toBe(9);
    expect(peak(0.9)).toBe(0);
    for (const [time, index] of [[0.45, 17], [0.9, 0]]) {
      expect(processingBounceFrame(time - 0.001, index).height)
        .toBeCloseTo(processingBounceFrame(time + 0.001, index).height, 5);
    }
  });

  it("keeps the packet inside the original bar height budget", () => {
    for (let time = 0; time < 3; time += 0.016) {
      for (let index = 0; index < 18; index++) {
        const { height, opacity } = processingBounceFrame(time, index);
        expect(height).toBeGreaterThanOrEqual(2);
        expect(height).toBeLessThanOrEqual(12);
        expect(opacity).toBeGreaterThanOrEqual(0.6);
        expect(opacity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("holds the original static profile with reduced motion", () => {
    for (let index = 0; index < 18; index++) {
      expect(processingBounceFrame(0.1, index, 18, true))
        .toEqual(processingBounceFrame(1.2, index, 18, true));
    }
  });
});
