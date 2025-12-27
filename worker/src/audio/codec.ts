export function parseFrameHeader(buf: Uint8Array) {
  // u32 seq | u32 nbytes | u64 ts
  const view = new DataView(buf.buffer, buf.byteOffset, 16);
  const seq = view.getUint32(0, true);
  const nbytes = view.getUint32(4, true);
  return { seq, nbytes };
}

export function concat(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export function wrapWav(
  pcm: Uint8Array,
  rate = 16000,
  channels = 1,
  bitsPerSample = 16,
): Uint8Array {
  const dataSize = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  // RIFF
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  // fmt
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  const byteRate = (rate * channels * bitsPerSample) >> 3;
  const blockAlign = (channels * bitsPerSample) >> 3;
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

function writeStr(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
