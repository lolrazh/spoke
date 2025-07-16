// public/audioworklet-processor.js
class CaptureProcessor extends AudioWorkletProcessor {
  // Each 16-bit sample is 2 bytes. 16000 samples/sec * 0.060 sec = 960 samples per chunk.
  pcm16 = new Int16Array(960);
  idx = 0;

  constructor() {
    super();
    console.log("CaptureProcessor: Initialized for 16kHz Int16 streaming.");
  }

  process(inputs, outputs, parameters) {
    // Use the first input and first channel, which is standard for mono mic input.
    const inputChannelData = inputs[0]?.[0];

    // If there's no data, we have nothing to do. Keep the processor alive.
    if (!inputChannelData) {
      return true;
    }

    // Decimate the 48kHz input to 16kHz by taking every 3rd sample.
    for (let i = 0; i < inputChannelData.length; i += 3) {
      // Clamp the sample to the [-1, 1] range to prevent clipping upon conversion.
      const sample = Math.max(-1, Math.min(1, inputChannelData[i]));

      // Convert the Float32 sample to a 16-bit integer.
      this.pcm16[this.idx++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

      // When the buffer is full, send it to the main thread.
      if (this.idx === 960) {
        // Post a copy of the buffer. The underlying ArrayBuffer is transferred.
        this.port.postMessage(this.pcm16.buffer.slice(0));
        this.idx = 0; // Reset index for the next chunk.
      }
    }

    // Return true to indicate the processor should not be terminated.
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
