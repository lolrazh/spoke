// utils/pcm16-to-wav.ts
export function pcm16ToWav(samples: Int16Array, sampleRate = 16000): Blob {
  const bytesPerSample = 2; // 16-bit
  const blockAlign = 1 * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  let offset = 0;

  const writeString = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset++, str.charCodeAt(i));
    }
  };

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;

  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4; // fmt chunk size

  view.setUint16(offset, 1, true);
  offset += 2; // PCM audio format

  view.setUint16(offset, 1, true);
  offset += 2; // Mono

  view.setUint32(offset, sampleRate, true);
  offset += 4;

  view.setUint32(offset, byteRate, true);
  offset += 4;

  view.setUint16(offset, blockAlign, true);
  offset += 2;

  view.setUint16(offset, 16, true);
  offset += 2; // 16 bits per sample

  writeString("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  return new Blob([header, samples.buffer], { type: "audio/wav" });
}
