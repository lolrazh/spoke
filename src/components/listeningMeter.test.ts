import { describe, expect, it } from "vitest";
import { ListeningMeter, speechMeterLevel } from "./listeningMeter";

describe("Willow speech bars", () => {
  it("uses the recovered decibel range and gain without modifying PCM", () => {
    expect(speechMeterLevel(0.0005)).toBe(0);
    expect(speechMeterLevel(0.01)).toBeCloseTo(15 / 55 * 1.2);
    expect(speechMeterLevel(0.03)).toBeCloseTo((20 * Math.log10(0.03) + 55) / 55 * 1.2);
    expect(speechMeterLevel(1)).toBe(1);
    expect(speechMeterLevel(NaN)).toBe(0);
  });

  it("starts with visible shaped bars instead of filling a trail from the left", () => {
    const meter = new ListeningMeter(8, 0);
    const heights = Array.from(meter.advance(16));
    expect(heights[3]).toBeGreaterThan(6);
    expect(heights[4]).toBeGreaterThan(6);
    expect(heights[0]).toBe(2);
    expect(heights[7]).toBe(2);
    expect(heights.filter((height) => height > 2)).toHaveLength(6);
  });

  it("keeps steady speech shaped around the middle rather than a traveling peak", () => {
    const meter = new ListeningMeter(8, 0);
    for (let time = 0; time <= 1500; time += 10) {
      meter.observe(0.02, time);
      const heights = Array.from(meter.advance(time));
      expect(heights[0]).toBeLessThan(heights[3]);
      expect(heights[7]).toBeLessThan(heights[4]);
    }
  });

  it("retargets smoothly and settles if audio updates stop", () => {
    const meter = new ListeningMeter(8, 0);
    meter.observe(0.08, 0);
    const before = Array.from(meter.advance(50));
    const after = Array.from(meter.advance(51));
    expect(Math.max(...after.map((height, index) => Math.abs(height - before[index])))).toBeLessThan(0.01);
    expect(Array.from(meter.advance(1000))).toEqual(Array(8).fill(2));
  });

  it("keeps reduced-motion feedback tied to current speech without decorative motion", () => {
    const meter = new ListeningMeter(8, 0);
    meter.observe(0.04, 0);
    const speaking = Array.from(meter.advance(20, true));
    expect(speaking[3]).toBeGreaterThan(5);
    meter.observe(0.04, 100);
    expect(Array.from(meter.advance(120, true))).toEqual(speaking);
    meter.observe(0, 140);
    expect(Array.from(meter.advance(150, true))).toEqual(Array(8).fill(2));
  });
});
