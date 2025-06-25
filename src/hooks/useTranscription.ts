import { useRef, useState, useEffect, useCallback } from "react";
import { RingBuffer } from "../audio/ring-buffer"; // Using the imported class
import {
  TARGET_AUDIO_CONTEXT_RATE,
  TARGET_SAMPLE_RATE,
  MICROPHONE_PREFERRED_RATE,
  MAX_RING_BUFFER_SECONDS,
} from "../config/audio";
import type {
  WorkerOutgoingMessage,
  InitWorkerMessage,
  InitializeAsrMessage,
  StartCaptureMessage,
  StopCaptureMessage,
} from "../types/worker-messages";

// Define CloudEngine type first
type CloudEngine = "groq" | "gemini";

// Global worklet registry to prevent double registration
const workletRegistry = new Set<string>();

// REMOVED local RingBuffer interface to use the imported class
// interface RingBuffer { ... }

// NEW util: pulls everything that has been written to the SAB
async function drainSabToFloat32(
  ring: RingBuffer | null,
): Promise<Float32Array> {
  if (!ring) {
    console.error("[drainSabToFloat32] RingBuffer instance is null!");
    return new Float32Array(0);
  }
  const total = ring.availableRead();
  if (total === 0) {
    console.log("[drainSabToFloat32] No data available to read.");
    return new Float32Array(0);
  }
  const buf = new Float32Array(total);
  ring.read(buf); // The imported RingBuffer.read(targetBuffer) fills buf and returns null.
  // The buf itself is modified.
  return buf;
}

// NEW util: trims silence from audio data
function trimSilence(f32: Float32Array, thresh = 0.005): Float32Array {
  if (f32.length === 0) return f32;
  let l = 0,
    r = f32.length - 1;
  while (l < f32.length && Math.abs(f32[l]) < thresh) l++;

  if (l === f32.length) {
    // All samples are below threshold
    console.log("[trimSilence] Audio is all silence.");
    return new Float32Array(0);
  }

  while (r > l && Math.abs(f32[r]) < thresh) r--;
  return f32.subarray(l, r + 1);
}

// Define the hook's return type
export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  text: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  currentMode: "local" | "cloud";
  setMode: (mode: "local" | "cloud") => void;
  cloudEngine: CloudEngine;
  setCloudEngine: (engine: CloudEngine) => void;
  setTimings?: (timings: Record<string, number>) => void; // Optional: if you want to pass it to UI
}

// Helper function to encode Float32Array to WAV ArrayBuffer
function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16; // 16-bit PCM
  const bytesPerSample = bitsPerSample / 8;

  const dataSize = samples.length * numChannels * bytesPerSample;
  const fileSize = 44 + dataSize; // 44 bytes for header

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, fileSize - 8, true); // fileSize - 8
  writeString(8, "WAVE");

  // fmt chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byteRate
  view.setUint16(32, numChannels * bytesPerSample, true); // blockAlign
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i])); // Clamp to [-1, 1]
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true); // Convert to 16-bit signed int
  }
  return buffer;
}

export function useTranscription(): UseTranscriptionReturn {
  // --- Refs for local ASR (AudioWorklet, SAB, local-worker) --
  const localWorkerRef = useRef<Worker | null>(null);
  // These refs are now potentially shared or re-initialized for cloud AudioWorklet path
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sabRef = useRef<SharedArrayBuffer | null>(null);
  const ringBufferRef = useRef<RingBuffer | null>(null); // Will hold instance of imported RingBuffer

  const localAudioSampleRateRef = useRef<number>(TARGET_AUDIO_CONTEXT_RATE);

  // --- REMOVED Refs for Cloud ASR (MediaRecorder) --
  // const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // const audioChunksRef = useRef<Blob[]>([]);

  // --- Common Refs --
  const streamRef = useRef<MediaStream | null>(null); // Mic stream, shared by both modes
  const profilingStartTimeRef = useRef<number | null>(null); // For profiling E2E latency

  // --- State Variables --
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false); // General readiness. Mic access is a key part.
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<"local" | "cloud">("local"); // Default to local mode
  const [cloudEngine, setCloudEngine] = useState<CloudEngine>("groq");

  // Refs to track the latest state for potential callbacks
  const readyRef = useRef(ready);
  const processingRef = useRef(processing);
  const textRef = useRef(text);

  // Update refs whenever state changes
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);
  useEffect(() => {
    processingRef.current = processing;
  }, [processing]);
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // --- Effects for Mic Permission (runs for both modes initially) --
  useEffect(() => {
    (async () => {
      if (streamRef.current) return; // Mic stream already obtained
      console.log("[useTranscription] Requesting microphone access...");
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: MICROPHONE_PREFERRED_RATE, // Prefer 48kHz
            channelCount: 1, // Mono audio
            echoCancellation: false,
            noiseSuppression: false, // Lower CPU, ASR models often handle noise
          },
        });
        console.log("[useTranscription] Microphone access granted.");
        setReady(true); // Basic readiness: mic is available.
      } catch (err) {
        console.error("[useTranscription] Microphone access error:", err);
        setError("Microphone permissions denied or microphone not available.");
        setReady(false);
      }
    })();
    // Cleanup mic stream when component unmounts
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      console.log("[useTranscription] Microphone stream stopped on unmount.");
    };
  }, []);

  // --- Effects for LOCAL ASR WORKER setup (only if mode is local) --
  useEffect(() => {
    if (currentMode === "local" && !localWorkerRef.current) {
      console.log(
        "[useTranscription] Local mode: Initializing local ASR worker, AudioContext, SAB...",
      );

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext({
          sampleRate: TARGET_AUDIO_CONTEXT_RATE,
        });
        localAudioSampleRateRef.current = audioCtxRef.current.sampleRate;
        console.log(
          `[useTranscription] AudioContext created (Rate: ${audioCtxRef.current.sampleRate}Hz).`,
        );
      }

      if (!sabRef.current && typeof SharedArrayBuffer !== "undefined") {
        const sabCapacitySamples = TARGET_SAMPLE_RATE * MAX_RING_BUFFER_SECONDS; // matches RingBuffer
        const pointerSizeBytes = 4; // For one Int32 write index, as per ring-buffer.ts
        const bufferSizeBytes =
          sabCapacitySamples * Float32Array.BYTES_PER_ELEMENT;
        const totalSabSizeBytes = pointerSizeBytes + bufferSizeBytes;

        try {
          sabRef.current = new SharedArrayBuffer(totalSabSizeBytes);
          console.log(
            `[useTranscription] SharedArrayBuffer created (${sabRef.current.byteLength} bytes).`,
          );
          ringBufferRef.current = new RingBuffer(sabRef.current);
          console.log(
            "[useTranscription] RingBuffer instance created for local mode.",
          );
        } catch (e) {
          console.error(
            "[useTranscription] Failed to create SharedArrayBuffer or RingBuffer for local mode:",
            e,
          );
          setError(
            "Failed to initialize audio buffer for local transcription.",
          );
          sabRef.current = null;
          ringBufferRef.current = null;
        }
      } else if (typeof SharedArrayBuffer === "undefined" && !sabRef.current) {
        console.error(
          "[useTranscription] Local mode: SharedArrayBuffer is not supported. Local ASR will not work.",
        );
        setError("SharedArrayBuffer not supported, local ASR disabled.");
        return; // Cannot proceed with local setup
      }

      // Initialize Local Worker
      try {
        console.log("[useTranscription] Creating local worker...");
        localWorkerRef.current = new Worker(
          new URL("../workers/local-worker.ts", import.meta.url),
          { type: "module" },
        );
        console.log(
          "[useTranscription] Local ASR worker instance created successfully.",
        );
      } catch (workerError) {
        console.error(
          "[useTranscription] Failed to create local worker:",
          workerError,
        );
        setError(`Failed to create local worker: ${workerError}`);
        return;
      }

      // Send INIT message to local worker with SAB
      if (sabRef.current) {
        const initMessage: InitWorkerMessage = {
          type: "init",
          data: { sab: sabRef.current },
        };
        localWorkerRef.current.postMessage(initMessage);
      } else {
        console.error(
          "[useTranscription] Local SAB not ready for init message to worker.",
        );
        setError("Failed to initialize local worker with audio buffer.");
        localWorkerRef.current.terminate();
        localWorkerRef.current = null;
        return;
      }

      // Send message to load local ASR model
      const asrInitMessage: InitializeAsrMessage = {
        type: "initialize-local-asr",
      };
      localWorkerRef.current.postMessage(asrInitMessage);
      // `ready` state for local will be set true by worker message 'asr_model_ready'
      setReady(false); // Set to false until local model confirms readiness
      setProcessing(true); // Indicate local model loading

      // Add message listener for the local worker
      const localWorkerListener = (e: MessageEvent<WorkerOutgoingMessage>) => {
        console.log("[useTranscription] Message from local-worker:", e.data);
        const message = e.data;
        const { status } = message;
        switch (status) {
          case "sab_initialized":
            console.log("[useTranscription] Local worker confirmed SAB init.");
            break;
          case "asr_model_loading":
            setProcessing(true);
            setReady(false);
            setText(""); // Ensure text is cleared when model is loading
            setError(null);
            console.log("[useTranscription] Local ASR model loading...");
            break;
          case "asr_model_ready":
            setProcessing(false);
            setReady(true);
            setError(null);
            console.log("[useTranscription] Local ASR model ready.");
            break;
          case "capture_started": // Handled by local worker
            setText(""); // Clear text when new capture starts
            break;
          case "partial": // Handle partial transcriptions for smoother UI updates
            if ("delta" in message && typeof message.delta === "string") {
              setText((prev) =>
                (prev + (prev ? " " : "") + message.delta).trim(),
              );
            }
            break;
          case "processing_full_audio": // Local worker processing
            setProcessing(true);
            break;
          case "completed": // Local transcription complete
            if ("transcription" in message) {
              setText(message.transcription || "");
              if (
                message.transcription &&
                window.electron?.insertTextAtCursor
              ) {
                window.electron
                  .insertTextAtCursor(message.transcription)
                  .catch((err) =>
                    console.error(
                      "[useTranscription] Error inserting local transcript:",
                      err,
                    ),
                  );
              }
            }
            setProcessing(false);
            break;
          case "error":
            if ("error" in message) {
              setError(message.error || "Local ASR worker error");
            }
            setProcessing(false);
            setReady(false);
            break;
          default:
            console.warn(
              "[useTranscription] Unknown message from local-worker:",
              e.data,
            );
        }
      };
      localWorkerRef.current.addEventListener("message", localWorkerListener);

      // Cleanup for local worker path
      return () => {
        console.log(
          "[useTranscription] Cleaning up local ASR worker and AudioContext.",
        );
        localWorkerRef.current?.terminate();
        localWorkerRef.current = null;
        audioCtxRef.current?.close().catch(console.error);
        audioCtxRef.current = null;
        // SAB and streamRef are managed by their own effects or refs
        // workletNode and microphoneSourceRef are cleaned up in stop() for local mode
        setReady(streamRef.current ? true : false); // Reset ready to mic status if switching away from local
        setProcessing(false);
      };
    } else if (currentMode === "cloud" && localWorkerRef.current) {
      // If switching from local to cloud, terminate the local worker and clean up
      console.log(
        "[useTranscription] Switched to Cloud mode. Terminating local ASR worker.",
      );
      localWorkerRef.current.terminate();
      localWorkerRef.current = null;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(console.error);
        audioCtxRef.current = null;
      }
      // Reset relevant states
      setReady(streamRef.current ? true : false); // Cloud ready if mic is available
      setProcessing(false);
    }
  }, [currentMode]);

  // --- 4️⃣ Public API ---
  const start = useCallback(async () => {
    console.log(`[useTranscription] start() called. Mode: ${currentMode}`);
    if (recording) {
      console.warn("[useTranscription] Already recording.");
      return;
    }
    if (!streamRef.current) {
      setError("Microphone stream not available. Cannot start recording.");
      console.error("[useTranscription] Mic stream not available for start().");
      setReady(false);
      return;
    }
    if (!ready && currentMode === "local") {
      setError("Local transcription engine not ready.");
      console.warn("[useTranscription] Local ASR not ready, cannot start.");
      return;
    }
    if (!ready && currentMode === "cloud") {
      setError("Mic not available or system not ready for cloud recording.");
      console.warn(
        "[useTranscription] Mic/System not ready for cloud recording.",
      );
      return;
    }

    setError(null);
    setText("");
    // setRecording(true) moved into mode-specific logic after async ops

    if (currentMode === "cloud") {
      console.log(
        "[useTranscription] Starting cloud recording with AudioWorklet...",
      );

      const ensureAudioContextReady = async () => {
        if (
          !audioCtxRef.current ||
          audioCtxRef.current.state === "closed" ||
          audioCtxRef.current.sampleRate !== TARGET_AUDIO_CONTEXT_RATE
        ) {
          audioCtxRef.current?.close().catch(console.error);
          audioCtxRef.current = new AudioContext({
            sampleRate: TARGET_AUDIO_CONTEXT_RATE,
          });
          console.log(
            `[useTranscription] Cloud: AudioContext created/recreated (Rate: ${audioCtxRef.current.sampleRate}Hz).`,
          );
        }
        if (audioCtxRef.current.state === "suspended") {
          await audioCtxRef.current.resume();
          console.log("[useTranscription] Cloud: AudioContext resumed.");
        }
      };

      const ensureWorkletLoaded = async (workletPath: string) => {
        if (!audioCtxRef.current)
          throw new Error("AudioContext not initialized for worklet loading.");

        // Check if worklet already registered
        if (workletRegistry.has(workletPath)) {
          console.log(
            `[useTranscription] Cloud: AudioWorklet module '${workletPath}' already registered, skipping.`,
          );
          return;
        }

        try {
          await audioCtxRef.current.audioWorklet.addModule(workletPath);
          workletRegistry.add(workletPath); // Mark as registered
          console.log(
            `[useTranscription] Cloud: AudioWorklet module '${workletPath}' added.`,
          );
        } catch (moduleError: unknown) {
          const error = moduleError as Error;
          if (
            error.name === "InvalidStateError" ||
            (error.message &&
              (error.message.includes("already been loaded") ||
                error.message.includes("has already been added")))
          ) {
            workletRegistry.add(workletPath); // Mark as registered even if browser says already loaded
            console.log(
              `[useTranscription] Cloud: AudioWorklet module '${workletPath}' already loaded by browser.`,
            );
          } else {
            console.error(
              "[useTranscription] Cloud: Error adding AudioWorklet module:",
              moduleError,
            );
            throw moduleError;
          }
        }
      };

      (async () => {
        try {
          setProcessing(true);
          await ensureAudioContextReady();

          if (!sabRef.current && typeof SharedArrayBuffer !== "undefined") {
            const sabCapacitySamples =
              TARGET_SAMPLE_RATE * MAX_RING_BUFFER_SECONDS; // matches RingBuffer
            const pointerSizeBytes = 4; // For one Int32 write index
            const bufferSizeBytes =
              sabCapacitySamples * Float32Array.BYTES_PER_ELEMENT;
            const totalSabSizeBytes = pointerSizeBytes + bufferSizeBytes;
            try {
              sabRef.current = new SharedArrayBuffer(totalSabSizeBytes);
              console.log(
                `[useTranscription] Cloud: SharedArrayBuffer created (${sabRef.current.byteLength} bytes).`,
              );
              ringBufferRef.current = new RingBuffer(sabRef.current);
              console.log(
                "[useTranscription] RingBuffer instance created for cloud mode.",
              );
            } catch (e) {
              console.error(
                "[useTranscription] Cloud: Failed to create SharedArrayBuffer or RingBuffer:",
                e,
              );
              setError("Failed to initialize audio buffer for cloud.");
              sabRef.current = null;
              ringBufferRef.current = null;
              setRecording(false);
              setProcessing(false);
              return;
            }
          } else if (
            !sabRef.current &&
            typeof SharedArrayBuffer === "undefined"
          ) {
            console.error(
              "[useTranscription] Cloud: SharedArrayBuffer is not supported.",
            );
            setError("SharedArrayBuffer not supported for cloud recording.");
            setRecording(false);
            setProcessing(false);
            return;
          }

          // If SAB exists but RingBuffer was not created (e.g. race condition or mode switch)
          if (sabRef.current && !ringBufferRef.current) {
            try {
              ringBufferRef.current = new RingBuffer(sabRef.current);
              console.log(
                "[useTranscription] Cloud: RingBuffer instance re-created/validated.",
              );
            } catch (e) {
              console.error(
                "[useTranscription] Cloud: Failed to create RingBuffer for existing SAB:",
                e,
              );
              setError("Failed to initialize RingBuffer for cloud recording.");
              setRecording(false);
              setProcessing(false);
              return;
            }
          }

          await ensureWorkletLoaded("/audioworklet-processor.js");

          if (
            !audioCtxRef.current ||
            !streamRef.current ||
            !sabRef.current ||
            !ringBufferRef.current
          ) {
            throw new Error(
              "Audio context, stream, SAB, or RingBuffer not available for cloud worklet setup.",
            );
          }

          microphoneSourceRef.current?.disconnect();
          workletNodeRef.current?.disconnect();

          // Reset RingBuffer before starting a new recording session
          ringBufferRef.current.reset();

          microphoneSourceRef.current =
            audioCtxRef.current.createMediaStreamSource(streamRef.current);
          workletNodeRef.current = new AudioWorkletNode(
            audioCtxRef.current,
            "capture-processor",
            {
              processorOptions: { sab: sabRef.current },
            },
          );
          microphoneSourceRef.current.connect(workletNodeRef.current);

          setRecording(true);
          setProcessing(false);
          console.log(
            "[useTranscription] Cloud AudioWorklet recording started.",
          );
        } catch (err: unknown) {
          console.error(
            "[useTranscription] Error starting cloud AudioWorklet recording:",
            err,
          );
          setError(`Failed to start cloud recording (worklet): ${(err as Error).message}`);
          setRecording(false);
          setProcessing(false);
        }
      })();
      // Old MediaRecorder logic for cloud start is now removed.
    } else {
      // currentMode === 'local'
      // Existing local mode start logic
      if (
        !localWorkerRef.current ||
        !audioCtxRef.current ||
        !sabRef.current ||
        !streamRef.current
      ) {
        setError("Local ASR system not fully initialized. Cannot start.");
        console.error(
          "[useTranscription] Attempted to start local recording but components are missing.",
        );
        setRecording(false);
        return;
      }
      console.log(
        "[useTranscription] Starting local recording with AudioWorklet...",
      );
      try {
        // Ensure AudioContext is running
        if (audioCtxRef.current.state === "suspended") {
          await audioCtxRef.current.resume();
        }
        const workletPath = "/audioworklet-processor.js";

        // Check if worklet already registered
        if (!workletRegistry.has(workletPath)) {
          try {
            await audioCtxRef.current.audioWorklet.addModule(workletPath);
            workletRegistry.add(workletPath); // Mark as registered
            console.log("[useTranscription] Local: AudioWorklet module added.");
          } catch (moduleError) {
            // Handle already loaded case
            if (
              String(moduleError).includes("already been loaded") ||
              String(moduleError).includes("has already been added")
            ) {
              workletRegistry.add(workletPath); // Mark as registered even if browser says already loaded
              console.log(
                "[useTranscription] Local: AudioWorklet module already loaded by browser.",
              );
            } else {
              console.error(
                "[useTranscription] Local: Error adding AudioWorklet module:",
                moduleError,
              );
              throw moduleError; // Propagate error
            }
          }
        } else {
          console.log(
            "[useTranscription] Local: AudioWorklet module already registered, skipping.",
          );
        }

        microphoneSourceRef.current =
          audioCtxRef.current.createMediaStreamSource(streamRef.current);
        workletNodeRef.current = new AudioWorkletNode(
          audioCtxRef.current,
          "capture-processor",
          {
            processorOptions: { sab: sabRef.current },
          },
        );
        microphoneSourceRef.current.connect(workletNodeRef.current);
        // DO NOT connect workletNode to destination unless debugging audio passthrough

        const startMessage: StartCaptureMessage = { type: "start-capture" };
        localWorkerRef.current.postMessage(startMessage);
        setRecording(true);
        console.log(
          "[useTranscription] Local recording started. AudioWorklet connected, worker notified.",
        );
      } catch (err: unknown) {
        console.error(
          "[useTranscription] Error starting local recording or AudioWorklet:",
          err,
        );
        setError(`Failed to start local recording: ${(err as Error).message}`);
        setRecording(false);
      }
    }
  }, [recording, currentMode, ready, streamRef]); // streamRef is now a dependency for mic check

  const stop = useCallback(async () => {
    console.log(
      `[useTranscription] stop() called. Mode: ${currentMode}, Engine: ${cloudEngine}`,
    );
    if (!recording) {
      console.warn("[useTranscription] Not recording, cannot stop.");
      return;
    }
    setRecording(false); // Set recording false immediately

    if (currentMode === "cloud") {
      console.log(
        "[useTranscription] Stopping cloud AudioWorklet recording...",
      );
      microphoneSourceRef.current?.disconnect();
      microphoneSourceRef.current = null;
      workletNodeRef.current?.disconnect();
      workletNodeRef.current = null;

      if (!ringBufferRef.current) {
        console.error(
          "[useTranscription] Cloud stop: RingBuffer not available. Ensure it's initialized.",
        );
        setError("Failed to process audio: RingBuffer instance missing.");
        // setProcessing(false); // Will be handled by finally if an async op was started
        return;
      }

      (async () => {
        setProcessing(true);
        // --- TIMING START ---
        const ts: Record<string, number> = {};
        const mark = (label: string) => (ts[label] = performance.now());
        // --- TIMING END ---
        try {
          mark("drain_start");
          const pcmF32 = await drainSabToFloat32(ringBufferRef.current);
          mark("drain_end");

          if (pcmF32.length === 0) {
            console.warn(
              "[useTranscription] No audio data from RingBuffer or data was all silence. Not sending.",
            );
            setText("");
            setProcessing(false);
            return;
          }

          mark("trim_start");
          const trimmedPcmF32 = trimSilence(pcmF32);
          mark("trim_end");

          if (trimmedPcmF32.length === 0) {
            console.warn(
              "[useTranscription] Audio is all silence after trimming. Not sending.",
            );
            setText("");
            setProcessing(false);
            return;
          }

          let transcript = "";
          let timingsFromMain: Record<string, number> = {};

          if (cloudEngine === "groq") {
            if (!window.electron?.transcribeGroq) {
              throw new Error(
                "Groq transcription service (window.electron.transcribeGroq) is not available.",
              );
            }
            const pcmF32ArrayBuffer = (
              trimmedPcmF32.buffer as ArrayBuffer
            ).slice(
              trimmedPcmF32.byteOffset,
              trimmedPcmF32.byteOffset + trimmedPcmF32.byteLength,
            );
            console.log(
              `[useTranscription] Sending raw PCM F32 (${pcmF32ArrayBuffer.byteLength} bytes) to Groq...`,
            );

            mark("ipc_start");
            const groqResult = await window.electron.transcribeGroq(
              pcmF32ArrayBuffer,
              [pcmF32ArrayBuffer],
              ts, // Pass renderer ts object (contains drain_start, drain_end, trim_start, trim_end, ipc_start)
            );
            mark("ipc_end");

            transcript = groqResult.transcript;
            timingsFromMain = groqResult.timings || {}; // { main_net, worker_pcm_to_wav, worker_stt_api_call }
          } else {
            // Gemini
            const wavBuf = encodeWAV(trimmedPcmF32, TARGET_AUDIO_CONTEXT_RATE);
            if (!window.electron?.transcribeGemini) {
              throw new Error(
                "Gemini transcription service (window.electron.transcribeGemini) is not available.",
              );
            }
            console.log(
              `[useTranscription] Sending WAV (${wavBuf.byteLength} bytes) to Gemini...`,
            );

            mark("ipc_start");
            const geminiFullResult = await window.electron.transcribeGemini(
              wavBuf,
              "audio/wav",
              [wavBuf],
              ts, // Pass renderer ts object
            );
            mark("ipc_end");
            transcript = geminiFullResult.text;
            timingsFromMain = geminiFullResult.timings || {}; // { main_net, worker_stt_api_call }
          }

          // --- TIMING CALCULATION & LOGGING (New Disjoint Logic) ---
          const drain_duration = ts["drain_end"] - ts["drain_start"];
          const trim_duration = ts["trim_end"] - ts["trim_start"];
          const ipc_full_round_trip_by_renderer =
            ts["ipc_end"] - ts["ipc_start"];

          // Sum of disjoint parts received from main process
          // Ensure all expected keys from timingsFromMain are numbers and sum them up
          const sum_of_disjoint_parts_from_main = Object.values(
            timingsFromMain,
          ).reduce(
            (sum, value) => sum + (typeof value === "number" ? value : 0),
            0,
          );

          const ipc_renderer_exclusive_overhead = Math.max(
            0,
            ipc_full_round_trip_by_renderer - sum_of_disjoint_parts_from_main,
          );

          const allDisjointTimings: Record<string, number> = {
            drain: drain_duration,
            trim: trim_duration,
            ipc_overhead: ipc_renderer_exclusive_overhead, // Exclusive IPC overhead
            // Spread timings received from main, which are already disjoint parts like main_net, worker_pcm_to_wav, worker_stt_api_call
            ...timingsFromMain,
          };

          // Calculate total_end_to_end by summing all disjoint parts
          allDisjointTimings.total_end_to_end = Object.values(
            allDisjointTimings,
          ).reduce(
            (sum, value) => sum + (typeof value === "number" ? value : 0),
            0,
          );

          console.log(
            `[useTranscription] Timings for ${cloudEngine} (disjoint):`,
          );
          console.table(allDisjointTimings);

          // Original profiling log (can be updated or removed)
          if (profilingStartTimeRef.current) {
            // const endTime = performance.now();
            // const durationTotalActual = endTime - profilingStartTimeRef.current;
            console.log(
              `[useTranscription] Profiling: Cloud Worklet - ${cloudEngine} transcript received.`,
            );
            console.log(
              `[useTranscription]   Summed E2E from table: ${allDisjointTimings.total_end_to_end.toFixed(2)} ms`,
            );
            // console.log(`[useTranscription]   Actual Wall Clock E2E (stop() to result): ${durationTotalActual.toFixed(2)} ms`);
            profilingStartTimeRef.current = null;
          }

          setText(transcript);
          if (transcript && window.electron.insertTextAtCursor) {
            window.electron
              .insertTextAtCursor(transcript)
              .catch((err) =>
                console.error(
                  `[useTranscription] Error inserting ${cloudEngine} text:`,
                  err,
                ),
              );
          }
        } catch (err: unknown) {
          console.error(
            "[useTranscription] Error during cloud AudioWorklet transcription or IPC:",
            err,
          );
          setError((err as Error).message || "Cloud transcription (worklet) failed.");
        } finally {
          setProcessing(false);
        }
      })();
      // Old MediaRecorder logic for cloud stop is now removed.
    } else {
      // currentMode === 'local'
      // Existing local mode stop logic
      console.log(
        "[useTranscription] Stopping local recording. Disconnecting AudioWorklet, notifying worker.",
      );
      if (microphoneSourceRef.current) {
        microphoneSourceRef.current.disconnect();
        microphoneSourceRef.current = null;
      }
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }
      if (localWorkerRef.current) {
        const stopMessage: StopCaptureMessage = {
          type: "stop-capture-and-transcribe",
          data: {
            timestamp: profilingStartTimeRef.current || performance.now(),
          },
        };
        localWorkerRef.current.postMessage(stopMessage);
        // setProcessing(true); // Worker will send messages to update processing state
      } else {
        console.error(
          "[useTranscription] Local worker not available to stop capture.",
        );
        setError("Failed to send stop signal to local transcription worker.");
      }
    }
  }, [recording, currentMode]);

  const setMode = useCallback(
    (mode: "local" | "cloud") => {
      if (mode === currentMode) return;
      console.log(
        `[useTranscription] Setting mode from ${currentMode} to: ${mode}`,
      );

      // If currently recording, stop it before switching modes
      if (recording) {
        console.warn(
          "[useTranscription] Recording active. Stopping current recording before mode switch.",
        );
        // Calling stop here will use the logic for the *current* mode before it changes.
        stop();
      }

      setCurrentMode(mode);
      setText("");
      setError(null);
      setProcessing(false);
      // `ready` state will be managed by the useEffect for local worker init or mic check for cloud.
      // When switching to cloud, if mic is available (streamRef.current exists), it should be ready.
      // When switching to local, ready will be false until local model is loaded.
      if (mode === "cloud") {
        setReady(streamRef.current ? true : false);
      } else {
        setReady(false); // Will be set true by local worker init effect
      }
    },
    [currentMode, recording, stop],
  ); // Added stop and recording as dependencies for safety

  return {
    recording,
    processing,
    ready,
    text,
    error,
    start,
    stop,
    currentMode,
    setMode,
    cloudEngine,
    setCloudEngine,
  };
}

// Mock for environments where window.electron might not be fully defined (e.g. web testing)
// This should align with the interface Window.electron expected by the hook.
if (typeof window !== "undefined" && !(window as any).electron) {
  console.log(
    "[useTranscription] Mocking window.electron API for development/testing.",
  );
  (window as any).electron = {
    toggleDictation: () => {
      console.log("[Mock Electron] toggleDictation called");
      return () => console.log("[Mock Electron] cleanup toggleDictation");
    },
    showPillContextMenu: () => {
      console.log("[Mock Electron] showPillContextMenu called");
    },
    insertTextAtCursor: async (text: string) => {
      console.log(
        `[Mock Electron] insertTextAtCursor called with: "${text.substring(0, 50)}..."`,
      );
      // return Promise.resolve(); // Original was Promise<void>
      return { success: true }; // If the expected type is Promise<{success: boolean; error?: string;}>
    },
    viewLogFile: async () => {
      console.log("[Mock Electron] viewLogFile called");
      return Promise.resolve("Mock log file content");
    },
    sendNotification: (message: string) => {
      console.log(`[Mock Electron] sendNotification called with: "${message}"`);
    },
    transcribeGroq: async (
      audioBuffer: ArrayBuffer,
      transferList?: Transferable[],
      upstreamTimings?: Record<string, number>,
    ): Promise<{ transcript: string; timings: Record<string, number> }> => {
      console.warn(
        `[Mock Electron] transcribeGroq called with ArrayBuffer (length: ${audioBuffer.byteLength}). Upstream timings:`,
        upstreamTimings,
      );
      // Simulate some main/worker timings for the mock
      const mockMainTimings = {
        main_pack: Math.random() * 10,
        main_to_worker: Math.random() * 50,
        worker_pcm_to_wav: Math.random() * 5,
        worker_groq_api: Math.random() * 500,
        worker_to_main: Math.random() * 50,
        main_to_renderer: Math.random() * 1,
      };
      return new Promise((resolve) =>
        setTimeout(() => {
          resolve({
            transcript: "Mocked Groq transcript from window.electron mock.",
            timings: mockMainTimings,
          });
        }, 500),
      );
    },
    transcribeGemini: async (
      audioBuffer: ArrayBuffer,
      mimeType: string,
      transferList?: Transferable[],
      upstreamTimings?: Record<string, number>,
    ): Promise<{ text: string; timings?: Record<string, number> }> => {
      console.warn(
        `[Mock Electron] transcribeGemini called with ArrayBuffer (length: ${audioBuffer.byteLength}, mimeType: ${mimeType}). Upstream timings:`,
        upstreamTimings,
      );
      // const cloudEngine = 'gemini'; // This would need to be available in this scope or passed
      const mockMainTimings = {
        main_pack: Math.random() * 10,
        main_to_worker: Math.random() * 50,
        worker_gemini_api: Math.random() * 600,
        worker_to_main: Math.random() * 50,
        main_to_renderer: Math.random() * 1,
      };
      return new Promise((resolve) =>
        setTimeout(() => {
          resolve({
            text: "Mocked Gemini transcript from window.electron mock.",
            timings: mockMainTimings,
          });
        }, 500),
      );
    },
  };
}
