/*
  AudioWorkletProcessor that:
  - Accepts mono Float32 input at the AudioContext sampleRate (typically 48k or 44.1k)
  - Resamples to 16,000 Hz using linear interpolation (cheap, good for speech)
  - Converts to signed Int16
  - Buffers a configurable frame length (frameSamples), default 100 ms (1600 samples at 16k),
    and posts frames to the main thread as transferable ArrayBuffers
*/

class Pcm16DownsamplerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetSampleRate || 16000;
    this.frameSamples = opts.frameSamples || 1600; // default 100 ms @ 16k; overridden by node options

    this.inputRate = sampleRate; // AudioContext's rate
    this.ratio = this.inputRate / this.targetRate;

    // Choose mode: passthrough (16k), decimate-by-3 (48k->16k), or generic linear
    this.mode = 'linear';
    if (Math.abs(this.inputRate - this.targetRate) < 1) {
      this.mode = 'passthrough';
    } else if (Math.abs(this.ratio - 3) < 1e-6) {
      this.mode = 'decimate3';
    }

    // Resampler state
    this._last = 0.0; // for linear
    this._pos = 0.0; // for linear

    // Decimator-by-3 state (small FIR low-pass, Hamming windowed-sinc)
    if (this.mode === 'decimate3') {
      // Design a 31-tap low-pass with fc = 8k/48k = 1/6
      const TAPS = 31;
      const fc = 1 / 6; // normalized to sample rate
      const taps = new Float32Array(TAPS);
      const M = TAPS - 1;
      let sum = 0;
      for (let n = 0; n < TAPS; n++) {
        const k = n - M / 2;
        const sinc = k === 0 ? 1 : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
        const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / M); // Hamming
        const h = 2 * fc * sinc * w;
        taps[n] = h;
        sum += h;
      }
      // Normalize DC gain to 1
      for (let n = 0; n < TAPS; n++) taps[n] /= sum;
      this._taps = taps;
      this._dl = new Float32Array(TAPS);
      this._dlIdx = 0;
      this._phase = 0; // emit every 3rd sample
    }

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
      } else if (msg.type === 'flush') {
        // Emit any remaining partial frame as-is (may be < frameSamples)
        if (this._accum.length > 0) {
          const out = new Int16Array(this._accum.length);
          for (let k = 0; k < this._accum.length; k++) out[k] = this._accum[k];
          this._accum.length = 0;
          this.port.postMessage(
            { type: 'audio', seq: this._seq++, rate: this.targetRate, samples: out.buffer },
            [out.buffer]
          );
        }
      }
    };
  }

  _flushFramesIfReady() {
    if (this._accum.length >= this.frameSamples) {
      const out = new Int16Array(this.frameSamples);
      for (let k = 0; k < this.frameSamples; k++) out[k] = this._accum[k];
      if (this._accum.length === this.frameSamples) {
        this._accum.length = 0;
      } else {
        this._accum = this._accum.slice(this.frameSamples);
      }
      this.port.postMessage(
        { type: 'audio', seq: this._seq++, rate: this.targetRate, samples: out.buffer },
        [out.buffer]
      );
    }
  }

  _linearResample(input) {
    const srcLen = input.length;
    if (srcLen === 0) return;
    const windowLen = srcLen + 1;
    const window = new Float32Array(windowLen);
    window[0] = this._last;
    window.set(input, 1);
    while (this._pos + 1 < windowLen) {
      const i = Math.floor(this._pos);
      const t = this._pos - i;
      const a = window[i];
      const b = window[i + 1];
      let s = a + (b - a) * t;
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this._accum.push((s * 0x7fff) | 0);
      this._flushFramesIfReady();
      this._pos += this.ratio;
    }
    this._pos -= (windowLen - 1);
    this._last = window[windowLen - 1];
  }

  _decimateBy3(input) {
    const taps = this._taps;
    const dl = this._dl;
    const TAPS = taps.length;
    let idx = this._dlIdx;
    let phase = this._phase;
    for (let n = 0; n < input.length; n++) {
      dl[idx] = input[n];
      idx = (idx + 1) % TAPS;
      phase++;
      if (phase === 3) {
        // Convolution centered at idx-1 (most recent sample)
        let acc = 0.0;
        let di = (idx - 1 + TAPS) % TAPS;
        for (let k = 0; k < TAPS; k++) {
          acc += taps[k] * dl[di];
          di = (di - 1 + TAPS) % TAPS;
        }
        // Clamp and convert
        if (acc > 1) acc = 1; else if (acc < -1) acc = -1;
        this._accum.push((acc * 0x7fff) | 0);
        this._flushFramesIfReady();
        phase = 0;
      }
    }
    this._dlIdx = idx;
    this._phase = phase;
  }

  _passthrough(input) {
    for (let i = 0; i < input.length; i++) {
      let s = input[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this._accum.push((s * 0x7fff) | 0);
      this._flushFramesIfReady();
    }
  }

  process(inputs /*, outputs, parameters */) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const ch0 = input[0]; // mono expected
    if (ch0 && ch0.length) {
      if (this.mode === 'passthrough') this._passthrough(ch0);
      else if (this.mode === 'decimate3') this._decimateBy3(ch0);
      else this._linearResample(ch0);
    }
    return true; // keep alive
  }
}

registerProcessor('pcm16-downsampler', Pcm16DownsamplerProcessor);
