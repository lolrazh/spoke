// Streaming-only utils

// Encode a per-frame header used for streaming PCM frames over WebSocket.
// Layout (little-endian): u32 seq | u32 nbytes | u64 client_ts_ns
export function encodeFrameHeader(
  seq: number,
  nbytes: number,
  tsNs: bigint,
): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const view = new DataView(buf);
  // u32 seq
  view.setUint32(0, seq >>> 0, true);
  // u32 nbytes
  view.setUint32(4, nbytes >>> 0, true);
  // u64 tsNs (split into two u32 little-endian)
  const lo = Number(tsNs & BigInt(0xffffffff));
  const hi = Number((tsNs >> BigInt(32)) & BigInt(0xffffffff));
  view.setUint32(8, lo >>> 0, true);
  view.setUint32(12, hi >>> 0, true);
  return buf;
}
