// This file will contain the AudioWorkletProcessor code.
// It runs on the real-time audio rendering thread.

// Import the RingBuffer class (adjust path if necessary)
import { RingBuffer } from './ring-buffer.js'; // Use .js extension for module resolution

// Augment the global scope for AudioWorkletProcessor types if not using @types/audioworklet
declare global {
  function registerProcessor(name: string, processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;
  const currentFrame: number;
  const sampleRate: number;
  interface AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
  }
  // Define the base class if needed (though typically provided by the environment)
  class AudioWorkletProcessor {
    constructor(options?: AudioWorkletNodeOptions);
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
  }
  interface AudioWorkletNodeOptions {
     numberOfInputs?: number;
     numberOfOutputs?: number;
     outputChannelCount?: number[];
     parameterData?: Record<string, number>;
     processorOptions?: any;
  }
}


/**
 * An AudioWorkletProcessor that captures raw audio samples (Float32)
 * and writes them into a RingBuffer residing in a SharedArrayBuffer.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  private ringBuffer: RingBuffer | null = null;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);

    if (!options?.processorOptions?.sab) {
      console.error('CaptureProcessor: SharedArrayBuffer not provided in processorOptions.sab');
      // Can't operate without the SAB
      return;
    }

    try {
      this.ringBuffer = new RingBuffer(options.processorOptions.sab);
      console.log('CaptureProcessor: RingBuffer initialized successfully.');
    } catch (error) {
      console.error('CaptureProcessor: Failed to initialize RingBuffer:', error);
      this.ringBuffer = null;
    }

     // Optional: Listen for messages from the main thread (e.g., stop command)
     this.port.onmessage = (event) => {
      console.log('CaptureProcessor received message:', event.data);
      // Handle messages if needed, e.g., event.data.command === 'reset' -> this.ringBuffer?.reset();
    };
  }

  /**
   * Called by the audio engine with new audio blocks.
   * @param inputs Array of inputs. We expect one input, mono. inputs[0][0] is the Float32Array.
   * @param outputs Array of outputs (not used here).
   * @param parameters Audio parameters (not used here).
   * @returns boolean Keep processor alive? true = yes.
   */
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    // Check if the ring buffer was initialized successfully
     if (!this.ringBuffer) {
       // console.warn('CaptureProcessor: RingBuffer not available, dropping audio.');
       return true; // Keep alive, maybe it will be initialized later? Or handle error differently.
     }

    // Get the first channel of the first input (mono audio)
    // input[0] represents the first input node connected to this worklet.
    // input[0][0] represents the first channel (mono) of that input.
    const inputChannelData = inputs[0]?.[0];

    // Basic sanity check
    if (!inputChannelData || inputChannelData.length === 0) {
      // console.log('CaptureProcessor: No input data received.');
      return true; // Keep alive even if there's no input data for a cycle
    }

    // Write the data to the ring buffer
    const written = this.ringBuffer.write(inputChannelData);
    if (written < inputChannelData.length) {
        // This indicates the buffer was full or had an issue.
        // Logging is handled within ringBuffer.write, but you could add extra logic here.
        // console.warn(`CaptureProcessor: Wrote only ${written}/${inputChannelData.length} frames`);
    } else {
       // console.log(`CaptureProcessor: Wrote ${written} frames`);
    }


    // Return true to keep the processor node alive
    return true;
  }
}

// Register the processor with the browser
try {
   registerProcessor('capture-processor', CaptureProcessor);
   console.log('CaptureProcessor registered.');
} catch (error) {
   console.error('Failed to register CaptureProcessor:', error);
} 