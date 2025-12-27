import { describe, it, expect } from "vitest";
import { concat, parseFrameHeader, wrapWav } from "./codec";

describe("audio/codec", () => {
  it("concat joins Uint8Array chunks in order", () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3]);
    const c = new Uint8Array([4, 5, 6]);
    const out = concat([a, b, c], a.length + b.length + c.length);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("wrapWav produces valid WAV header with correct sizes", () => {
    const rate = 16000;
    const pcm = new Uint8Array(3200); // 0.1s of mono 16-bit @ 16kHz
    const wav = wrapWav(pcm, rate, 1, 16);
    expect(wav.byteLength).toBe(44 + pcm.byteLength);

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
    );
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11),
    );
    const fmt = String.fromCharCode(
      view.getUint8(12),
      view.getUint8(13),
      view.getUint8(14),
      view.getUint8(15),
    );
    const data = String.fromCharCode(
      view.getUint8(36),
      view.getUint8(37),
      view.getUint8(38),
      view.getUint8(39),
    );
    expect(riff).toBe("RIFF");
    expect(wave).toBe("WAVE");
    expect(fmt).toBe("fmt ");
    expect(data).toBe("data");
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength);
    expect(view.getUint32(24, true)).toBe(rate);
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
  });

  it("parseFrameHeader reads seq and nbytes (little-endian)", () => {
    const buf = new Uint8Array(16 + 3); // header + payload
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const seq = 42;
    const nbytes = 3;
    view.setUint32(0, seq, true);
    view.setUint32(4, nbytes, true);
    // timestamp ignored in parser
    const parsed = parseFrameHeader(buf);
    expect(parsed.seq).toBe(seq);
    expect(parsed.nbytes).toBe(nbytes);
  });
});
