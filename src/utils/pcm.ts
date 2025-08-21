export function concatInt16(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// Write a minimal PCM WAV header (mono, 16-bit)
export function encodeWavInt16(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = samples.length * 2; // Int16
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, samples[i], true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Encode a per-frame header used for streaming PCM frames over WebSocket.
// Layout (little-endian): u32 seq | u32 nbytes | u64 client_ts_ns
export function encodeFrameHeader(seq: number, nbytes: number, tsNs: bigint): ArrayBuffer {
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
