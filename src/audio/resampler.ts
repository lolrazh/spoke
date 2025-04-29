// This file will contain the audio downsampling logic (48kHz to 16kHz).

console.log("Resampler file loaded (implementing simple FIR)");

/**
 * Downsamples a Float32Array from 48kHz to 16kHz using a simple 3-tap FIR filter (decimation).
 * This provides basic low-pass filtering to reduce aliasing.
 * Input buffer length must be a multiple of 3.
 * @param block48 The input Float32Array at 48kHz.
 * @returns A new Float32Array containing the downsampled audio at 16kHz.
 */
export function downsample48kTo16k(block48: Float32Array): Float32Array {
  if (block48.length % 3 !== 0) {
    console.warn(`Resampler: Input block length (${block48.length}) is not a multiple of 3. Result might be truncated.`);
    // Optionally, handle non-multiple lengths (e.g., padding, error)
  }
  const outLength = Math.floor(block48.length / 3);
  const out = new Float32Array(outLength);

  for (let i = 0, j = 0; i < outLength; i++, j += 3) {
    // Simple 3-tap FIR: 0.25 * prev + 0.5 * current + 0.25 * next (relative to 48k index j)
    // Ensure indices are within bounds, using edge values for boundary conditions.
    const p1 = block48[j] ?? 0; // Use 0 if j is out of bounds (shouldn't happen with loop logic)
    const p2 = block48[j + 1] ?? 0;
    const p3 = block48[j + 2] ?? 0;

    // Apply the filter weights
    out[i] = 0.25 * p1 + 0.5 * p2 + 0.25 * p3;
  }
  return out;
} 