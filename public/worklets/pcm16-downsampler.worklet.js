/*
  AudioWorkletProcessor that:
  - Accepts mono Float32 input at the AudioContext sampleRate (typically 48k or 44.1k)
  - Resamples to 16,000 Hz using linear interpolation (cheap, good for speech)
  - Converts to signed Int16
  - Buffers exactly 100 ms (1600 samples) and posts frames to the main thread as transferable ArrayBuffers
*/

class Pcm16DownsamplerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetSampleRate || 16000;
    this.frameSamples = opts.frameSamples || 1600; // 100 ms @ 16k

    this.inputRate = sampleRate; // AudioContext's rate
    this.ratio = this.inputRate / this.targetRate;

    // Resampler state
    this._last = 0.0;
    this._pos = 0.0; // fractional index into the rolling buffer [0..)

    // Output frame buffer (Int16 values in a JS array for accumulation)
    this._accum = [];
    this._seq = 0;

    // Respond to parameter updates from node if needed later
    this.port.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'reset') {
        this._last = 0.0;
        this._pos = 0.0;
        this._accum = [];
        this._seq = 0;
      }
    };
  }

  _resampleAndAccumulate(input) {
    // input: Float32Array (mono)
    const srcLen = input.length;
    if (srcLen === 0) return;

    // Build a rolling window including last sample to allow interpolation over block boundary
    const windowLen = srcLen + 1;
    const window = new Float32Array(windowLen);
    window[0] = this._last;
    window.set(input, 1);

    // Generate output samples at the target rate using linear interpolation
    while (this._pos + 1 < windowLen) {
      const i = Math.floor(this._pos);
      const t = this._pos - i; // [0,1)
      const a = window[i];
      const b = window[i + 1];
      // Linear interpolation
      let s = a + (b - a) * t;
      // Clamp to [-1, 1] just in case
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      // Convert to Int16
      const i16 = (s * 0x7fff) | 0; // fast truncate
      this._accum.push(i16);

      // If we have at least a frame, flush it
      if (this._accum.length >= this.frameSamples) {
        const out = new Int16Array(this.frameSamples);
        for (let k = 0; k < this.frameSamples; k++) out[k] = this._accum[k];
        // Remove consumed
        if (this._accum.length === this.frameSamples) {
          this._accum.length = 0;
        } else {
          this._accum = this._accum.slice(this.frameSamples);
        }
        // Transfer buffer
        this.port.postMessage(
          {
            type: 'audio',
            seq: this._seq++,
            rate: this.targetRate,
            samples: out.buffer,
          },
          [out.buffer]
        );
      }

      this._pos += this.ratio; // advance by inputRate/targetRate
    }

    // Keep leftover fractional position for next block
    this._pos -= (windowLen - 1);
    this._last = window[windowLen - 1];
  }

  process(inputs /*, outputs, parameters */) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const ch0 = input[0]; // mono expected
    if (ch0 && ch0.length) {
      this._resampleAndAccumulate(ch0);
    }
    return true; // keep alive
  }
}

registerProcessor('pcm16-downsampler', Pcm16DownsamplerProcessor);

