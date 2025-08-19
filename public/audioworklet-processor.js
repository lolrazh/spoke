// public/audioworklet-processor.js
// 16 kHz mono, 16-bit PCM output with fractional resampling + 20 ms framing.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Target output SR
    this.outSr = 16000;
    // Actual input SR
    this.inSr = sampleRate; // from AudioWorklet global
    this.ratio = this.outSr / this.inSr;   // ~0.3333 for 48k, ~0.3628 for 44.1k

    // 20 ms @ 16k = 320 samples per frame
    this.frameSamples = 320;
    this.int16Frame = new Int16Array(this.frameSamples);
    this.frameIdx = 0;

    // fractional resampler state
    this.t = 0;    // position in input samples (float)
    this.prev = 0; // previous input sample for interp
  }

  // Linear interpolate input at float position p
  lerp(read, p) {
    const i = Math.floor(p);
    const frac = p - i;
    const a = read(i) || 0;
    const b = read(i + 1) || a;
    return a + (b - a) * frac;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    const read = (i) => ch[i];

    // Produce out samples at 16k based on input buffer length
    const inLen = ch.length;
    const endPos = this.t + inLen; // position after consuming this block

    while (this.t < endPos) {
      const posInBlock = this.t - Math.floor(this.t); // fractional part, handled by lerp via absolute index
      // absolute position in the current process buffer
      const absPos = this.t - (endPos - inLen);

      // sample at position absPos (float) via linear interpolation
      const s = this.lerp((i) => ch[i], absPos);

      // float32 [-1, 1] -> int16
      const clamped = Math.max(-1, Math.min(1, s));
      this.int16Frame[this.frameIdx++] =
        clamped < 0 ? (clamped * 0x8000) | 0 : (clamped * 0x7fff) | 0;

      if (this.frameIdx === this.frameSamples) {
        // ship one 20ms frame
        this.port.postMessage(this.int16Frame.buffer.slice(0));
        this.frameIdx = 0;
      }

      // advance output time by one 16k sample -> input domain step = 1/ratio
      this.t += 1 / this.ratio;
    }

    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
