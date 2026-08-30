/* global sampleRate */

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
    const targetRate = Number(opts.targetSampleRate) || 16000;
    const frameSamples = Number(opts.frameSamples) || 1600;
    this.targetRate = Math.max(1, Math.floor(targetRate));
    this.frameSamples = Math.max(1, Math.floor(frameSamples)); // default 100 ms @ 16k

    this.inputRate = sampleRate; // AudioContext's rate
    this.ratio = this.inputRate / this.targetRate;

    // Choose mode: passthrough (16k), decimate-by-3 (48k->16k), or generic linear
    this.mode = "linear";
    if (Math.abs(this.inputRate - this.targetRate) < 1) {
      this.mode = "passthrough";
    } else if (Math.abs(this.ratio - 3) < 1e-6) {
      this.mode = "decimate3";
    }

    // Resampler state
    this._last = 0.0; // for linear
    this._pos = 0.0; // for linear

    // Decimator-by-3 state (small FIR low-pass, Hamming windowed-sinc)
    if (this.mode === "decimate3") {
      // Design a 31-tap low-pass with fc = 8k/48k = 1/6
      const TAPS = 31;
      const fc = 1 / 6; // normalized to sample rate
      const taps = new Float32Array(TAPS);
      const M = TAPS - 1;
      let sum = 0;
      for (let n = 0; n < TAPS; n++) {
        const k = n - M / 2;
        const sinc =
          k === 0 ? 1 : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
        const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / M); // Hamming
        const h = 2 * fc * sinc * w;
        taps[n] = h;
        sum += h;
      }
      // Normalize DC gain to 1
      for (let n = 0; n < TAPS; n++) taps[n] /= sum;
      this._taps = taps;
      // Store each delay-line sample twice. This lets the convolution scan
      // backward through a contiguous 31-sample range without a modulo or
      // wrap branch for every tap.
      this._dl = new Float32Array(TAPS * 2);
      this._dlIdx = 0;
      this._phase = 0; // emit every 3rd sample
    }

    // Output frame buffer. Keep this fixed-size on the audio thread to avoid
    // per-sample JS array growth and slicing during recording.
    this._frame = new Int16Array(this.frameSamples);
    this._frameIndex = 0;
    this._seq = 0;

    // Track pause state
    this._paused = false;

    // Respond to parameter updates from node if needed later
    this.port.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === "reset") {
        this._resetState();
        this._seq = 0;
        this._paused = false;
      } else if (msg.type === "flush") {
        this._emitPartialFrame();
        this.port.postMessage({
          type: "flushed",
          seq: this._seq,
          rate: this.targetRate,
        });
      } else if (msg.type === "pause") {
        this._paused = true;
      } else if (msg.type === "resume") {
        this._paused = false;
      }
    };
  }

  _resetState() {
    this._last = 0.0;
    this._pos = 0.0;
    this._frame = new Int16Array(this.frameSamples);
    this._frameIndex = 0;
    if (this.mode === "decimate3") {
      this._dl.fill(0);
      this._dlIdx = 0;
      this._phase = 0;
    }
  }

  _floatToInt16(sample) {
    if (sample > 1) sample = 1;
    else if (sample < -1) sample = -1;
    return sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  _pushSample(sample) {
    this._frame[this._frameIndex++] = this._floatToInt16(sample);
    if (this._frameIndex === this.frameSamples) {
      this._emitFullFrame();
    }
  }

  _postFrame(out) {
    this.port.postMessage(
      {
        type: "audio",
        seq: this._seq++,
        rate: this.targetRate,
        samples: out.buffer,
      },
      [out.buffer],
    );
  }

  _emitFullFrame() {
    const out = this._frame;
    this._frame = new Int16Array(this.frameSamples);
    this._frameIndex = 0;
    this._postFrame(out);
  }

  _emitPartialFrame() {
    if (this._frameIndex === 0) return;
    const out = new Int16Array(this._frameIndex);
    out.set(this._frame.subarray(0, this._frameIndex));
    this._frameIndex = 0;
    this._postFrame(out);
  }

  _linearResample(input) {
    const srcLen = input.length;
    if (srcLen === 0) return;
    // Read directly from the current render block. The previous sample is the
    // only value that crosses a block boundary, so a temporary [last, ...input]
    // window would only add a copy on every AudioWorklet callback.
    while (this._pos + 1 < srcLen + 1) {
      const i = Math.floor(this._pos);
      const t = this._pos - i;
      const a = i === 0 ? this._last : input[i - 1];
      const b = input[i];
      this._pushSample(a + (b - a) * t);
      this._pos += this.ratio;
    }
    this._pos -= srcLen;
    this._last = input[srcLen - 1];
  }

  _decimateBy3(input) {
    const taps = this._taps;
    const dl = this._dl;
    const TAPS = taps.length;
    let idx = this._dlIdx;
    let phase = this._phase;
    for (let n = 0; n < input.length; n++) {
      const sample = input[n];
      dl[idx] = sample;
      dl[idx + TAPS] = sample;
      idx += 1;
      if (idx === TAPS) idx = 0;
      phase++;
      if (phase === 3) {
        // idx points at the next write slot. The duplicated line guarantees
        // this range contains the most recent sample followed by all taps.
        let acc = 0.0;
        let di = idx + TAPS - 1;
        for (let k = 0; k < TAPS; k++) {
          acc += taps[k] * dl[di];
          di -= 1;
        }
        this._pushSample(acc);
        phase = 0;
      }
    }
    this._dlIdx = idx;
    this._phase = phase;
  }

  _passthrough(input) {
    for (let i = 0; i < input.length; i++) {
      this._pushSample(input[i]);
    }
  }

  process(inputs /*, outputs, parameters */) {
    // Skip processing if paused
    if (this._paused) {
      return true; // keep alive but don't process audio
    }

    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const ch0 = input[0]; // mono expected
    if (ch0 && ch0.length) {
      if (this.mode === "passthrough") this._passthrough(ch0);
      else if (this.mode === "decimate3") this._decimateBy3(ch0);
      else this._linearResample(ch0);
    }
    return true; // keep alive
  }
}

registerProcessor("pcm16-downsampler", Pcm16DownsamplerProcessor);
