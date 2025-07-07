// public/audioworklet-processor.js
// This file is a JavaScript copy of the TypeScript version for direct loading.

// Import the RingBuffer class.
// Path is relative from public root to src directory.
import { RingBuffer } from "../src/audio/ring-buffer.js";

// Define the base class if needed (though typically provided by the environment)
// Ensure AudioWorkletProcessor is available in the global scope
if (typeof AudioWorkletProcessor === "undefined") {
  console.error("AudioWorkletProcessor is not defined in this scope!");
  // Optionally define a dummy class to prevent further errors immediately
  // globalThis.AudioWorkletProcessor = class AudioWorkletProcessor { constructor(){} process(){return true;} };
}

/**
 * An AudioWorkletProcessor that captures raw audio samples (Float32)
 * and writes them into a RingBuffer residing in a SharedArrayBuffer.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  ringBuffer = null; // For local mode (SAB)
  frames = []; // For cloud mode (in-memory)
  isCloudMode = false;

  constructor(options) {
    super(options);

    const processorOptions = options?.processorOptions;

    if (processorOptions?.sab) {
      // LOCAL MODE: SAB provided, use RingBuffer
      this.isCloudMode = false;
      try {
        this.ringBuffer = new RingBuffer(processorOptions.sab);
        console.log("CaptureProcessor: RingBuffer initialized for LOCAL mode.");
      } catch (error) {
        console.error(
          "CaptureProcessor: Failed to initialize RingBuffer for LOCAL mode:",
          error,
        );
        this.ringBuffer = null;
      }
    } else {
      // CLOUD MODE: No SAB, accumulate frames in memory
      this.isCloudMode = true;
      console.log("CaptureProcessor: Initialized for CLOUD mode.");
    }

    // Listen for messages from the main thread
    this.port.onmessage = (event) => {
      // In cloud mode, the main thread can request the collected audio frames
      if (this.isCloudMode && event.data.type === "flush") {
        this.port.postMessage({ type: "frames", frames: this.frames });
        this.frames = []; // Reset frames for the next recording
      } else {
        console.log("CaptureProcessor received message:", event.data);
      }
    };
  }

  /**
   * Called by the audio engine with new audio blocks.
   */
  process(inputs, outputs, parameters) {
    // Get the first channel of the first input (mono audio)
    const inputChannelData = inputs[0]?.[0];

    if (!inputChannelData || inputChannelData.length === 0) {
      return true; // Keep alive, no data to process
    }

    if (this.isCloudMode) {
      // CLOUD MODE: Push a copy of the audio data into our frames array
      this.frames.push(new Float32Array(inputChannelData));
    } else {
      // LOCAL MODE: Write to the RingBuffer if it's available
      if (this.ringBuffer) {
        const written = this.ringBuffer.write(inputChannelData);
        if (written < inputChannelData.length) {
          // This warning can be noisy, uncomment if needed for debugging
          // console.warn(`CaptureProcessor: Wrote only ${written}/${inputChannelData.length} frames`);
        }
      }
    }

    // Return true to keep the processor node alive
    return true;
  }
}

// Register the processor with the browser
try {
  // Use the same name as before
  // Ensure registerProcessor is available
  if (typeof registerProcessor === "function") {
    registerProcessor("capture-processor", CaptureProcessor);
    console.log("CaptureProcessor registered (from public JS file).");
  } else {
    console.error("registerProcessor is not defined in this scope!");
  }
} catch (error) {
  console.error(
    "Failed to register CaptureProcessor (from public JS file):",
    error,
  );
}
