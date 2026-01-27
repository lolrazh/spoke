/**
 * Audio Recorder Utility
 *
 * Wraps MediaRecorder with Opus codec support for HTTP transcription.
 * Handles codec negotiation, audio level monitoring, and blob collection.
 */

export type AudioRecorderConfig = {
  onDataAvailable?: (blob: Blob) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
};

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrameId: number | null = null;
  private chunks: Blob[] = [];
  private config: AudioRecorderConfig;

  constructor(config: AudioRecorderConfig = {}) {
    this.config = config;
  }

  /**
   * Start recording from microphone
   */
  async start(stream: MediaStream): Promise<void> {
    // Validate stream
    const audioTracks = stream.getAudioTracks();
    console.log(
      `[AudioRecorder] Stream has ${audioTracks.length} audio tracks`,
    );

    if (audioTracks.length === 0) {
      throw new Error("MediaStream has no audio tracks");
    }

    const track = audioTracks[0];
    console.log(
      `[AudioRecorder] Track state: ${track.readyState}, enabled: ${track.enabled}`,
    );

    if (track.readyState !== "live") {
      throw new Error(`Audio track is not live (state: ${track.readyState})`);
    }

    // Negotiate codec (prefer Opus, fallback to webm)
    const mimeType = this.negotiateCodec();
    console.log(`[AudioRecorder] Using codec: ${mimeType}`);

    // Create MediaRecorder - try simplest approach first
    try {
      // Try with no options first (most compatible)
      this.mediaRecorder = new MediaRecorder(stream);
      console.log(
        `[AudioRecorder] Created MediaRecorder with default settings, mimeType: ${this.mediaRecorder.mimeType}`,
      );
    } catch (err) {
      console.error("[AudioRecorder] Failed to create MediaRecorder:", err);
      throw new Error(
        `Failed to create MediaRecorder: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.chunks = [];

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
        this.config.onDataAvailable?.(event.data);
      }
    };

    this.mediaRecorder.onerror = (event: Event) => {
      const error = new Error(`MediaRecorder error: ${(event as any).error}`);
      console.error("[AudioRecorder]", error);
      this.config.onError?.(error);
    };

    // Start recording
    try {
      console.log(
        `[AudioRecorder] Starting recording with state: ${this.mediaRecorder.state}`,
      );
      this.mediaRecorder.start();
      console.log(
        `[AudioRecorder] Recording started, new state: ${this.mediaRecorder.state}`,
      );
    } catch (err) {
      console.error("[AudioRecorder] Failed to start recording:", err);
      throw new Error(
        `Failed to start MediaRecorder: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Setup audio level monitoring if callback provided
    if (this.config.onAudioLevel) {
      this.setupAudioLevelMonitor(stream);
    }
  }

  /**
   * Stop recording and return final audio blob
   */
  async stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("MediaRecorder not initialized"));
        return;
      }

      this.mediaRecorder.onstop = () => {
        // Combine all chunks into single blob
        const blob = new Blob(this.chunks, {
          type: this.mediaRecorder?.mimeType || "audio/webm",
        });
        this.cleanup();
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancel recording without returning blob
   */
  cancel(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  /**
   * Get current state
   */
  get state(): "inactive" | "recording" | "paused" {
    return this.mediaRecorder?.state || "inactive";
  }

  /**
   * Negotiate best available codec
   */
  private negotiateCodec(): string {
    // Check if MediaRecorder.isTypeSupported exists
    if (typeof MediaRecorder.isTypeSupported !== "function") {
      console.warn(
        "[AudioRecorder] isTypeSupported not available, using default",
      );
      return "";
    }

    const codecs = [
      "audio/webm;codecs=opus", // Preferred: Opus in webm container
      "audio/webm", // Fallback: Default webm codec
      "audio/ogg;codecs=opus", // Alternative: Opus in ogg
      "audio/mp4", // Last resort: MP4
    ];

    for (const codec of codecs) {
      try {
        if (MediaRecorder.isTypeSupported(codec)) {
          console.log(`[AudioRecorder] Selected codec: ${codec}`);
          return codec;
        }
      } catch (err) {
        console.warn(`[AudioRecorder] Error checking codec ${codec}:`, err);
      }
    }

    // Fallback to browser default
    console.log("[AudioRecorder] Using browser default codec");
    return "";
  }

  /**
   * Setup audio level monitoring using Web Audio API
   */
  private setupAudioLevelMonitor(stream: MediaStream): void {
    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      const updateLevel = () => {
        if (!this.analyser || this.state !== "recording") {
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);

        // Calculate RMS (root mean square) for audio level
        const rms = Math.sqrt(
          dataArray.reduce((sum, val) => sum + val * val, 0) / dataArray.length,
        );

        // Normalize to 0-1 range
        const normalized = Math.min(rms / 128, 1);

        this.config.onAudioLevel?.(normalized);

        this.animationFrameId = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch (err) {
      console.warn("[AudioRecorder] Failed to setup audio level monitor:", err);
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(console.warn);
      this.audioContext = null;
    }

    this.analyser = null;
    this.mediaRecorder = null;
    this.chunks = [];
  }
}
