// lightweight, zero-dependency PCM ➜ WAV encoder
export function encodeWAV(
  samples: Float32Array,
  sampleRate = 16_000,
): ArrayBuffer {
  const numChannels = 1,
    bitsPerSample = 16,
    bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  const wr = (o: number, v: number, m?: "U8" | "U16" | "U32") =>
    m === "U16"
      ? view.setUint16(o, v, true)
      : m === "U32"
        ? view.setUint32(o, v, true)
        : view.setUint8(o, v);

  // RIFF header
  "RIFF".split("").forEach((c, i) => wr(i, c.charCodeAt(0)));
  wr(4, 36 + dataSize, "U32");
  "WAVEfmt ".split("").forEach((c, i) => wr(8 + i, c.charCodeAt(0)));
  wr(16, 16, "U32"); // fmt chunk size
  wr(20, 1, "U16"); // PCM
  wr(22, numChannels, "U16");
  wr(24, sampleRate, "U32");
  wr(28, sampleRate * numChannels * bytesPerSample, "U32");
  wr(32, numChannels * bytesPerSample, "U16");
  wr(34, bitsPerSample, "U16");
  "data".split("").forEach((c, i) => wr(36 + i, c.charCodeAt(0)));
  wr(40, dataSize, "U32");

  // PCM payload
  const out = new DataView(buf, 44);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}
