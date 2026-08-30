const EMPTY_PCM16 = new Int16Array(0);
const INITIAL_CAPACITY = 2_048;
const GROWTH_NUMERATOR = 5;
const GROWTH_DENOMINATOR = 4;

/**
 * Collects PCM16 samples without retaining one typed-array allocation per
 * capture frame. take() transfers the backing storage to the caller.
 */
export class Pcm16Accumulator {
  private buffer = EMPTY_PCM16;
  private sampleCount = 0;

  get length(): number {
    return this.sampleCount;
  }

  append(samples: Int16Array): void {
    if (samples.length === 0) return;

    const nextSampleCount = this.sampleCount + samples.length;
    if (nextSampleCount > this.buffer.length) {
      this.grow(nextSampleCount);
    }

    this.buffer.set(samples, this.sampleCount);
    this.sampleCount = nextSampleCount;
  }

  /** Return the captured samples and release the accumulator's reference. */
  take(): Int16Array {
    if (this.sampleCount === 0) {
      this.clear();
      return EMPTY_PCM16;
    }

    const result = this.buffer.subarray(0, this.sampleCount);
    this.buffer = EMPTY_PCM16;
    this.sampleCount = 0;
    return result;
  }

  /** Drop captured samples and release the backing buffer for collection. */
  clear(): void {
    this.buffer = EMPTY_PCM16;
    this.sampleCount = 0;
  }

  private grow(requiredCapacity: number): void {
    const grownCapacity =
      this.buffer.length === 0
        ? INITIAL_CAPACITY
        : Math.ceil(
            (this.buffer.length * GROWTH_NUMERATOR) / GROWTH_DENOMINATOR,
          );
    const next = new Int16Array(Math.max(requiredCapacity, grownCapacity));
    next.set(this.buffer.subarray(0, this.sampleCount));
    this.buffer = next;
  }
}
