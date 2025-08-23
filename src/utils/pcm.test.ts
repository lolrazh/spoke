import { describe, it, expect } from "vitest";
import { encodeFrameHeader } from "./pcm";

describe("encodeFrameHeader", () => {
  it("encodes seq, nbytes, and tsNs in little-endian", () => {
    const seq = 42;
    const nbytes = 1024;
    const tsNs = (BigInt(1) << BigInt(40)) + BigInt(12345); // ensure hi/lo parts

    const buf = encodeFrameHeader(seq, nbytes, tsNs);
    expect(buf.byteLength).toBe(16);

    const view = new DataView(buf);
    const gotSeq = view.getUint32(0, true);
    const gotNbytes = view.getUint32(4, true);
    const lo = view.getUint32(8, true);
    const hi = view.getUint32(12, true);
    const gotTs = (BigInt(hi) << BigInt(32)) + BigInt(lo);

    expect(gotSeq).toBe(seq >>> 0);
    expect(gotNbytes).toBe(nbytes >>> 0);
    expect(gotTs).toBe(tsNs);
  });
});
