export function trimSilence(f32: Float32Array, thresh = 0.005): Float32Array {
  if (f32.length === 0) return f32;
  let l = 0,
    r = f32.length - 1;
  while (l < f32.length && Math.abs(f32[l]) < thresh) l++;

  if (l === f32.length) {
    // All samples are below threshold
    console.log("[trimSilence] Audio is all silence.");
    return new Float32Array(0);
  }

  while (r > l && Math.abs(f32[r]) < thresh) r--;
  return f32.subarray(l, r + 1);
}

// NEW HELPER for Option B: Concatenate Float32Array chunks
export function concatenateFloat32Arrays(arrays: Float32Array[]): Float32Array {
  if (!arrays || arrays.length === 0) {
    return new Float32Array(0);
  }
  const totalLength = arrays.reduce((acc, val) => acc + val.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
} 