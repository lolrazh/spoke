// public/audioworklet-processor.js
// This file is a JavaScript copy of the TypeScript version for direct loading.

// Import the RingBuffer class.
// Path is relative from public root to src directory.
import { RingBuffer } from '../src/audio/ring-buffer.js';
// Import the new resampler function
import { resample48kTo16k } from '../src/audio/resample.js';

// Define the base class if needed (though typically provided by the environment)
// Ensure AudioWorkletProcessor is available in the global scope
if (typeof AudioWorkletProcessor === 'undefined') {
    console.error("AudioWorkletProcessor is not defined in this scope!");
    // Optionally define a dummy class to prevent further errors immediately
    // globalThis.AudioWorkletProcessor = class AudioWorkletProcessor { constructor(){} process(){return true;} };
}


/**
 * An AudioWorkletProcessor that captures raw audio samples (Float32)
 * and writes them into a RingBuffer residing in a SharedArrayBuffer.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  ringBuffer = null; // Use instance property instead of private field for JS

  constructor(options) { // Remove TS parameter type
    super(options);

    const processorOptions = options?.processorOptions; // Easier access

    if (!processorOptions?.sab) {
      console.error('CaptureProcessor: SharedArrayBuffer not provided in processorOptions.sab');
      return;
    }

    try {
      // Directly use processorOptions.sab
      this.ringBuffer = new RingBuffer(processorOptions.sab);
      console.log('CaptureProcessor: RingBuffer initialized successfully.');
    } catch (error) {
      console.error('CaptureProcessor: Failed to initialize RingBuffer:', error);
      this.ringBuffer = null;
    }

     // Optional: Listen for messages from the main thread
     this.port.onmessage = (event) => {
      console.log('CaptureProcessor received message:', event.data);
      // Handle messages if needed, e.g., event.data.command === 'reset' -> this.ringBuffer?.reset();
    };
  }

  /**
   * Called by the audio engine with new audio blocks.
   */
  process(inputs, outputs, parameters) { // Remove TS parameter types
    // Check if the ring buffer was initialized successfully
     if (!this.ringBuffer) {
       // console.warn('CaptureProcessor: RingBuffer not available, dropping audio.');
       return true; // Keep alive
     }

    // Get the first channel of the first input (mono audio)
    const inputChannelData = inputs[0]?.[0];

    // Basic sanity check
    if (!inputChannelData || inputChannelData.length === 0) {
      // console.log('CaptureProcessor: No input data received.');
      return true; // Keep alive
    }

    // Resample the input data from 48kHz (assumed) to 16kHz
    // This assumes the input from the microphone/browser is at 48kHz.
    // If the actual input sample rate can vary, this needs to be more robust,
    // potentially getting the actual sample rate via processorOptions or elsewhere.
    const resampledData16k = resample48kTo16k(inputChannelData);

    // Write the RESAMPLED data to the ring buffer
    if (resampledData16k.length > 0) {
        const written = this.ringBuffer.write(resampledData16k);
        if (written < resampledData16k.length) {
            // Logging handled in RingBuffer
            // console.warn(`CaptureProcessor: Wrote only ${written}/${resampledData16k.length} frames of resampled data`);
        }
    } else if (inputChannelData.length > 0) {
        // console.warn('CaptureProcessor: Resampling resulted in empty audio data, nothing to write.');
    }

    // Return true to keep the processor node alive
    return true;
  }
}

// Register the processor with the browser
try {
   // Use the same name as before
   // Ensure registerProcessor is available
   if (typeof registerProcessor === 'function') {
       registerProcessor('capture-processor', CaptureProcessor);
       console.log('CaptureProcessor registered (from public JS file).');
   } else {
       console.error("registerProcessor is not defined in this scope!");
   }
} catch (error) {
   console.error('Failed to register CaptureProcessor (from public JS file):', error);
}