const HISTORY_LENGTH = 8;
const SAMPLE_INTERVAL_MS = 40;
const STALE_INPUT_MS = 200;
const ANIMATION_MS = 80;
const REST_HEIGHT = 2;
const HEIGHT_SCALE = 12;

/** RMS -> decibels -> display level mapping. PCM stays unchanged. */
export function speechMeterLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 55) / 55) * 1.2);
}

/**
 * Bar calculation recovered from Willow Voice 2.5.1's audio monitor and
 * WaveformView: eight readings with 20% shorter timing, center weighting, small per-bar variation,
 * and a moving accent only above the speech thresholds. No peak-hold trail.
 */
export class ListeningMeter {
  private readonly history = new Float32Array(HISTORY_LENGTH).fill(0.4);
  private readonly heights: Float32Array;
  private readonly origins: Float32Array;
  private readonly targets: Float32Array;
  private input = 0;
  private inputTime: number;
  private sampleTime: number;
  private animationTime: number;
  private readonly startTime: number;

  constructor(private readonly barCount: number, now: number) {
    this.heights = new Float32Array(barCount).fill(REST_HEIGHT);
    this.origins = new Float32Array(barCount);
    this.targets = new Float32Array(barCount);
    this.startTime = now;
    this.inputTime = now;
    this.sampleTime = now;
    this.animationTime = now;
    this.updateTargets(now);
    this.heights.set(this.targets);
    this.origins.set(this.targets);
  }

  observe(rms: number, now: number): void {
    this.input = speechMeterLevel(rms);
    this.inputTime = now;
  }

  advance(now: number, reducedMotion = false): Float32Array {
    const stale = now - this.inputTime > STALE_INPUT_MS;
    if (reducedMotion || stale) {
      for (let index = 0; index < this.barCount; index++) {
        this.heights[index] = Math.max(REST_HEIGHT,
          (stale ? 0 : this.input) * HEIGHT_SCALE * this.weight(index));
      }
      if (stale) this.history.fill(0);
      this.origins.set(this.heights);
      this.targets.set(this.heights);
      this.animationTime = now;
      this.sampleTime = now;
      return this.heights;
    }

    // Retarget from the current on-screen heights, as SwiftUI does when
    // another audio reading arrives during its 80ms ease-in-out animation.
    const blend = easeInOut(Math.min(1, Math.max(0, (now - this.animationTime) / ANIMATION_MS)));
    for (let index = 0; index < this.barCount; index++) {
      this.heights[index] = this.origins[index] +
        (this.targets[index] - this.origins[index]) * blend;
    }

    const steps = Math.floor((now - this.sampleTime) / SAMPLE_INTERVAL_MS);
    if (steps > 0) {
      const firstStep = Math.max(1, steps - HISTORY_LENGTH + 1);
      for (let step = firstStep; step <= steps; step++) {
        const sampleTime = this.sampleTime + step * SAMPLE_INTERVAL_MS;
        const phase = (sampleTime - this.startTime) / 800;
        const baseline = (Math.sin(phase * 4) + 1) * 0.03 + 0.03;
        this.history.copyWithin(0, 1);
        this.history[HISTORY_LENGTH - 1] = Math.min(1, this.input + baseline);
      }
      this.sampleTime += steps * SAMPLE_INTERVAL_MS;
      this.origins.set(this.heights);
      this.updateTargets(now);
      this.animationTime = now;
    }
    return this.heights;
  }

  private weight(index: number): number {
    const center = (this.barCount - 1) / 2;
    return center === 0 ? 1 : 1 - Math.abs(index - center) / center * 0.7;
  }

  private updateTargets(now: number): void {
    const seconds = (now - this.startTime) / 800;
    const average = this.history.reduce((sum, level) => sum + level, 0) / HISTORY_LENGTH;
    const accent = Math.floor((now - this.startTime) / 80) % this.barCount;
    for (let index = 0; index < this.barCount; index++) {
      const position = this.barCount === 1 ? HISTORY_LENGTH - 1 :
        (1 - index / (this.barCount - 1)) * (HISTORY_LENGTH - 1);
      const lower = Math.floor(position);
      const upper = Math.min(HISTORY_LENGTH - 1, lower + 1);
      const fraction = position - lower;
      let level = this.history[lower] * (1 - fraction) + this.history[upper] * fraction;
      level += (Math.sin(seconds * 2 + index * 0.5) + 1) * 0.15;
      if (average > 0.84 && index === accent) level += average * 0.3;
      if (average > 0.6) {
        if (index === accent) level += 0.2;
        if (Math.abs(index - accent) === 1) level += 0.1;
      }
      this.targets[index] = Math.max(REST_HEIGHT, level * this.weight(index) * HEIGHT_SCALE);
    }
  }
}

/** CSS/SwiftUI ease-in-out timing curve: cubic-bezier(0.42, 0, 0.58, 1). */
function easeInOut(progress: number): number {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 12; iteration++) {
    const t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * 0.42 + 3 * (1 - t) * t ** 2 * 0.58 + t ** 3;
    if (x < progress) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return 3 * (1 - t) * t ** 2 + t ** 3;
}
