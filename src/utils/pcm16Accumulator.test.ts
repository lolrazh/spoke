import { describe, expect, it } from "vitest";
import { Pcm16Accumulator } from "./pcm16Accumulator";

describe("Pcm16Accumulator", () => {
  it("appends frames and transfers the captured view on take", () => {
    const accumulator = new Pcm16Accumulator();
    accumulator.append(new Int16Array([1, 2]));
    accumulator.append(new Int16Array([3, 4, 5]));

    const captured = accumulator.take();

    expect(Array.from(captured)).toEqual([1, 2, 3, 4, 5]);
    expect(accumulator.length).toBe(0);
    expect(accumulator.take()).toHaveLength(0);
  });

  it("releases the backing storage when cleared", () => {
    const accumulator = new Pcm16Accumulator();
    accumulator.append(new Int16Array([1, 2, 3]));
    accumulator.clear();

    expect(accumulator.length).toBe(0);
    expect(accumulator.take()).toHaveLength(0);
  });
});
