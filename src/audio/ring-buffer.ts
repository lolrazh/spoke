// This file will contain the RingBuffer implementation
// using SharedArrayBuffer and Atomics.

console.log("RingBuffer file loaded (placeholder)");

const MAX_RING_SECONDS = 10; // NEW - Target buffer duration

// Calculate capacity for 16kHz * MAX_RING_SECONDS
const SAMPLE_RATE_16K = 16000; // Define 16k constant
const RING_BUFFER_SAMPLE_CAPACITY = SAMPLE_RATE_16K * MAX_RING_SECONDS; // Use 16k for capacity

// Helper function to calculate byte length needed for RingBuffer
// Includes space for the atomic write index (Int32 = 4 bytes)
function getByteLength(capacity: number): number {
  return capacity * Float32Array.BYTES_PER_ELEMENT + 4;
}

const RING_BUFFER_SIZE_BYTES = getByteLength(RING_BUFFER_SAMPLE_CAPACITY);

/**
 * A Lock-Free Ring Buffer implementation using SharedArrayBuffer for
 * single-producer, single-consumer scenarios.
 *
 * The first 4 bytes (index 0) of the SAB store the write index (head) as an Int32.
 * The remaining bytes store the Float32 audio samples.
 */
export class RingBuffer {
  private readonly sab: SharedArrayBuffer;
  private readonly writeIndex: Int32Array; // Atomic view for the write index
  private readonly buffer: Float32Array; // View for the audio data
  private readonly capacity: number;

  // Used by the consumer (reader) to track its position
  private readIndex = 0;

  /**
   * Creates or wraps a SharedArrayBuffer for the RingBuffer.
   * @param sab Optional SharedArrayBuffer to wrap. If not provided, a new one is created.
   */
  constructor(sab?: SharedArrayBuffer) {
    this.capacity = RING_BUFFER_SAMPLE_CAPACITY;

    if (sab) {
      if (sab.byteLength !== RING_BUFFER_SIZE_BYTES) {
        throw new Error(
          `Provided SharedArrayBuffer has incorrect size. Expected ${RING_BUFFER_SIZE_BYTES}, got ${sab.byteLength}`,
        );
      }
      this.sab = sab;
    } else {
      this.sab = new SharedArrayBuffer(RING_BUFFER_SIZE_BYTES);
    }

    // Index 0 holds the write pointer (head)
    this.writeIndex = new Int32Array(this.sab, 0, 1);
    // The rest holds the audio data (offset by 4 bytes)
    this.buffer = new Float32Array(this.sab, 4, this.capacity);
  }

  /**
   * Get the underlying SharedArrayBuffer. Needed to share with other threads.
   */
  getSharedArrayBuffer(): SharedArrayBuffer {
    return this.sab;
  }

  /**
   * Write audio frames from the producer (AudioWorklet).
   * This is lock-free due to Atomics.add.
   * @param frames The Float32Array containing audio frames to write.
   * @returns The number of frames successfully written.
   */
  write(frames: Float32Array): number {
    const availableWrite = this.capacity - this.availableRead();
    if (frames.length > availableWrite) {
      console.warn(
        `RingBuffer overflow: Tried to write ${frames.length}, but only ${availableWrite} available.`,
      );
      // Optional: Could drop frames or overwrite oldest, for now just log.
      return 0; // Indicate nothing was written to prevent partial writes easily
    }

    // Get the current write position atomically
    // `Atomics.add` returns the *original* value before adding.
    // We add 0 to atomically get the current value, then manually add later.
    // This might seem complex, but ensures we get a consistent starting point before the write.
    // EDIT: Simpler approach - use Atomics.load, then copy, then Atomics.store if guaranteed single producer.
    // Sticking to Atomics.add as it's robust for adding length atomically IF we ensure no wrap-around read interference.
    // Let's refine: Atomically get current head, write, then atomically update head.

    const currentWriteIndex = Atomics.load(this.writeIndex, 0);
    const framesToCopy = frames.length;

    // Check for wrap-around
    const spaceToEnd = this.capacity - currentWriteIndex;
    if (framesToCopy <= spaceToEnd) {
      // No wrap-around needed
      this.buffer.set(frames, currentWriteIndex);
    } else {
      // Needs to wrap around
      const firstChunk = frames.subarray(0, spaceToEnd);
      const secondChunk = frames.subarray(spaceToEnd);
      this.buffer.set(firstChunk, currentWriteIndex);
      this.buffer.set(secondChunk, 0);
    }

    // Atomically update the write index, wrapping around if necessary
    const nextWriteIndex = (currentWriteIndex + framesToCopy) % this.capacity;
    Atomics.store(this.writeIndex, 0, nextWriteIndex);
    // console.log(`Wrote ${framesToCopy} frames. New write index: ${nextWriteIndex}`);

    // Notify potentially waiting reader (optional, depends on reader implementation)
    // Atomics.notify(this.writeIndex, 0, 1); // Notify one waiter

    return framesToCopy;
  }

  /**
   * Read available audio frames for the consumer.
   * Updates the internal read pointer.
   * @param targetBuffer Optional buffer to write into. If not provided, a new Float32Array is returned.
   * @returns The Float32Array containing the read frames, or null if targetBuffer was provided.
   */
  read(targetBuffer?: Float32Array): Float32Array | null {
    const available = this.availableRead();
    if (available === 0) {
      return targetBuffer ? null : new Float32Array(0); // Return empty if nothing to read
    }

    const framesToRead = targetBuffer
      ? Math.min(available, targetBuffer.length)
      : available;
    let result: Float32Array;

    if (targetBuffer) {
      result =
        targetBuffer.length >= framesToRead
          ? targetBuffer.subarray(0, framesToRead)
          : targetBuffer; // Use subarray if target is larger
    } else {
      result = new Float32Array(framesToRead);
    }

    // Check for wrap-around during read
    const spaceToEnd = this.capacity - this.readIndex;
    if (framesToRead <= spaceToEnd) {
      // No wrap-around
      result.set(
        this.buffer.subarray(this.readIndex, this.readIndex + framesToRead),
      );
    } else {
      // Wraps around
      const firstChunk = this.buffer.subarray(this.readIndex, this.capacity);
      const secondChunk = this.buffer.subarray(0, framesToRead - spaceToEnd);
      result.set(firstChunk, 0);
      result.set(secondChunk, firstChunk.length);
    }

    // Update the read index
    this.readIndex = (this.readIndex + framesToRead) % this.capacity;
    // console.log(`Read ${framesToRead} frames. New read index: ${this.readIndex}`);

    return targetBuffer ? null : result; // Return the new array only if no target was given
  }

  /**
   * Returns the number of frames available to read.
   * This is lock-free due to Atomics.load.
   */
  availableRead(): number {
    const currentWriteIndex = Atomics.load(this.writeIndex, 0);
    if (currentWriteIndex >= this.readIndex) {
      // Write head is ahead of read head (no wrap-around)
      return currentWriteIndex - this.readIndex;
    } else {
      // Write head has wrapped around
      return this.capacity - this.readIndex + currentWriteIndex;
    }
  }

  /**
   * Returns the total capacity of the buffer in frames.
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Resets the read and write pointers.
   * NOTE: Only call this when you are sure the producer is stopped!
   */
  reset(): void {
    Atomics.store(this.writeIndex, 0, 0);
    this.readIndex = 0;
    console.log("RingBuffer reset.");
  }

  /**
   * Static helper to calculate byte length based on sample capacity.
   */
  static getByteLength(capacity: number): number {
    return capacity * Float32Array.BYTES_PER_ELEMENT + 4;
  }
}

// Define constants for export if needed elsewhere
export const Constants = {
  MAX_RING_SECONDS, // Export MAX_RING_SECONDS
  RING_BUFFER_SAMPLE_CAPACITY,
  RING_BUFFER_SIZE_BYTES,
};
