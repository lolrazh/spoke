import { useRef, useState, useEffect, useCallback } from "react";
import { RingBuffer } from "../audio/ring-buffer"; // Using the imported class
import { playToggleOn, playToggleOff } from "../utils/audioFeedback";
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
import {
  concatenateFloat32Arrays,
  trimSilence,
} from "../utils/audio";

// Define CloudEngine type first
type CloudEngine = "groq" | "gemini";

// Global worklet registry to prevent double registration
const workletRegistry = new Set<string>();

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

type PipelineStage = { name: string; ms: number };

function collectPipeline(
  audio: { concat: number; trim: number },
  roundTrip: number,
  timingsFromMain: any,
  measuredTotal: number,
): PipelineStage[] {
  const s: PipelineStage[] = [];

  s.push({ name: "audio-concat", ms: audio.concat });
  s.push({ name: "audio-trim", ms: audio.trim });

  // The total time spent in the main process, including its own async tasks like network calls.
  const mainProcess = timingsFromMain.main_total || 0;

  // The total IPC time is the roundTrip minus the time spent working in the main process.
  // This can only be negative if there is significant clock skew or measurement error.
  const totalIpcTime = Math.max(0, roundTrip - mainProcess);

  // We cannot measure the one-way IPC latency with a single `invoke` call.
  // As a reasonable estimate, we assume the journey to and from main is symmetric.
  const ipcToMain = totalIpcTime / 2;
  const ipcToRender = totalIpcTime / 2;

  s.push({ name: "ipc-to-main", ms: ipcToMain });
  s.push({ name: "main-process-total", ms: mainProcess });

  // Client network phases from got (these are sub-timings within main-process-total)
  const client = timingsFromMain.client_phases || {};
  const clientTtfb = client.firstByte || 0;
  const upstreamTtfb = timingsFromMain.server_upstream_ttfb_ms || 0;
  const edgeTravel = clientTtfb > upstreamTtfb ? clientTtfb - upstreamTtfb : 0;

  if (client.request) s.push({ name: "main-upload", ms: client.request });
  if (edgeTravel) s.push({ name: "edge-travel", ms: edgeTravel });

  // Worker phases (also sub-timings within main-process-total)
  const workerTotal = timingsFromMain.server_worker_total_ms || 0;
  if (workerTotal) s.push({ name: "worker-total", ms: workerTotal });

  if (upstreamTtfb) s.push({ name: "upstream-ttfb", ms: upstreamTtfb });
  if (client.download) s.push({ name: "download", ms: client.download });

  s.push({ name: "ipc-to-render", ms: ipcToRender });

  // The sum of the identified parts.
  const sumOfParts =
    audio.concat + audio.trim + ipcToMain + mainProcess + ipcToRender;

  // The unaccounted time is the difference between the separately measured total
  // and the sum of the parts we've identified. This is great for debugging.
  const unaccounted = measuredTotal - sumOfParts;
  if (unaccounted > 1) {
    s.push({ name: "unaccounted-renderer", ms: unaccounted });
  }

  // The sum of the identified parts for verification.
  s.push({ name: "total-calculated", ms: sumOfParts });

  // The actual measured wall-clock time.
  s.push({ name: "total-measured", ms: measuredTotal });

  return s;
}

function collectLocalPipeline(
  uiTotalTime: number,
  workerTimings: Record<string, number>,
): PipelineStage[] {
  const s: PipelineStage[] = [];

  const asrInferenceTime = workerTimings.total_asr_inference_ms || 0;
  const overhead = uiTotalTime - asrInferenceTime;

  s.push({ name: "total-measured-e2e", ms: uiTotalTime });
  s.push({ name: "├─ asr-inference", ms: asrInferenceTime });
  s.push({ name: "└─ overhead", ms: overhead });

  return s;
}

export function useTranscription(): UseTranscriptionReturn {
  // --- Refs for local ASR (AudioWorklet, SAB, local-worker) --
  const localWorkerRef = useRef<Worker | null>(null);
  const localTimingRef = useRef<{ stopTime: number | null }>({
    stopTime: null,
  });
  const wavEncoderWorkerRef = useRef<Worker | null>(null);
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

  // New function to lazily initialize the WAV encoder worker
  const ensureWavEncoderWorker = () => {
    if (!wavEncoderWorkerRef.current) {
      console.log(
        "[useTranscription] Cloud mode: Lazily initializing WAV encoder worker...",
      );
      wavEncoderWorkerRef.current = new Worker(
        new URL("../workers/wav-encoder.ts", import.meta.url),
        { type: "module" },
      );
    }
    return wavEncoderWorkerRef.current;
  };

  // Refs to track the latest state for potential callbacks
  const readyRef = useRef(ready);
  const processingRef = useRef(processing);
  const textRef = useRef(text);
  const lastApiCallTimestampRef = useRef<number>(0);

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

              if (localTimingRef.current.stopTime && message.timings) {
                const uiTotalTime =
                  performance.now() - localTimingRef.current.stopTime;
                const pipelineStages = collectLocalPipeline(
                  uiTotalTime,
                  message.timings,
                );
                console.log("[useTranscription] Timings for local mode:");
                console.table(pipelineStages);
                localTimingRef.current.stopTime = null; // Reset for next run
              }

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

  // --- Effects for Cloud WAV Encoder WORKER setup (only if mode is cloud) --
  useEffect(() => {
    // This effect now only handles cleanup.
    // If we switch away from cloud mode, terminate any existing worker.
    if (currentMode !== "cloud" && wavEncoderWorkerRef.current) {
      console.log(
        "[useTranscription] Switched away from cloud mode. Terminating WAV encoder worker.",
      );
      wavEncoderWorkerRef.current.terminate();
      wavEncoderWorkerRef.current = null;
    }

    // On unmount, ensure the worker is terminated.
    return () => {
      if (wavEncoderWorkerRef.current) {
        console.log(
          "[useTranscription] Terminating WAV encoder worker on unmount.",
        );
        wavEncoderWorkerRef.current.terminate();
        wavEncoderWorkerRef.current = null;
      }
    };
  }, [currentMode]);

  // Helper function for worker communication with timeout
  const getWavFromWorkerWithTimeout = (
    worker: Worker,
    audioData: Float32Array,
    timeout = 3000,
  ): Promise<{ wavBuffer: ArrayBuffer }> => {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        cleanup();
        reject(new Error("WAV encoder worker timed out."));
      }, timeout);

      const onMessage = (event: MessageEvent<{ wavBuffer: ArrayBuffer }>) => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        cleanup();
        resolve(event.data);
      };

      const onError = (error: ErrorEvent) => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({
        audioData: audioData,
        sampleRate: TARGET_AUDIO_CONTEXT_RATE,
      });
    });
  };

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

    playToggleOn();
    setError(null);
    setText("");

    // setRecording(true) moved into mode-specific logic after async ops

    if (currentMode === "cloud") {
      // --- Pre-warm the connection (if necessary) ---
      const now = Date.now();
      if (now - lastApiCallTimestampRef.current > 25000) {
        console.log(
          "[useTranscription] Connection likely cold, sending warm-up request.",
        );
        window.electron.warmUpConnection(cloudEngine);
        lastApiCallTimestampRef.current = now;
      } else {
        console.log(
          "[useTranscription] Connection likely warm, skipping warm-up request.",
        );
      }

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

          // CLOUD MODE - NO SAB/RingBuffer NEEDED FOR WORKLET
          // We will accumulate audio in the worklet itself.
          // The SAB/RingBuffer logic is now removed from this path.

          await ensureWorkletLoaded("/audioworklet-processor.js");

          if (!audioCtxRef.current || !streamRef.current) {
            throw new Error(
              "Audio context or stream not available for cloud worklet setup.",
            );
          }

          microphoneSourceRef.current?.disconnect();
          workletNodeRef.current?.disconnect();

          microphoneSourceRef.current =
            audioCtxRef.current.createMediaStreamSource(streamRef.current);

          // For cloud mode, we initialize the worklet WITHOUT the SAB.
          // This triggers the in-memory frame collection logic.
          workletNodeRef.current = new AudioWorkletNode(
            audioCtxRef.current,
            "capture-processor",
          );

          microphoneSourceRef.current.connect(workletNodeRef.current);

          setRecording(true);
          setProcessing(false);
          console.log(
            "[useTranscription] Cloud AudioWorklet recording started (in-memory accumulation).",
          );
        } catch (err: unknown) {
          console.error(
            "[useTranscription] Error starting cloud AudioWorklet recording:",
            err,
          );
          setError(
            `Failed to start cloud recording (worklet): ${(err as Error).message}`,
          );
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
    playToggleOff();
    setRecording(false); // Set recording false immediately

    if (currentMode === "cloud") {
      console.log(
        "[useTranscription] Stopping cloud AudioWorklet recording...",
      );

      if (!workletNodeRef.current) {
        console.error(
          "[useTranscription] Cloud stop: WorkletNode not available. Cannot flush audio.",
        );
        setError("Failed to process audio: Audio worklet missing.");
        return; // Early exit
      }

      (async () => {
        setProcessing(true);
        const totalProcessingStart = performance.now();
        // --- TIMING START ---
        const ts: Record<string, number> = {};
        const mark = (label: string) => (ts[label] = performance.now());
        // --- TIMING END ---

        // Listen for the response from the worklet
        workletNodeRef.current.port.onmessage = async (event) => {
          if (event.data.type !== "frames") return;

          mark("frames_received");
          const { frames } = event.data;

          // Disconnect nodes now that we have the data
          microphoneSourceRef.current?.disconnect();
          microphoneSourceRef.current = null;
          workletNodeRef.current?.disconnect();
          workletNodeRef.current = null;

          try {
            mark("concat_start");
            const pcmF32 = concatenateFloat32Arrays(frames);
            mark("concat_end");

            if (pcmF32.length === 0) {
              console.warn(
                "[useTranscription] No audio data from Worklet. Not sending.",
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

            mark("ipc_start");
            if (cloudEngine === "gemini") {
              if (!window.electron?.transcribeGemini) {
                throw new Error(
                  "Gemini transcription service (window.electron.transcribeGemini) is not available.",
                );
              }

              const worker = ensureWavEncoderWorker();
              if (!worker) {
                throw new Error("WAV encoder worker could not be initialized.");
              }

              mark("wav_encode_start");
              const wavResult = await getWavFromWorkerWithTimeout(
                worker,
                trimmedPcmF32,
              );
              mark("wav_encode_end");

              const { wavBuffer } = wavResult;
              console.log(
                `[useTranscription] Sending WAV (${wavBuffer.byteLength} bytes) to Gemini...`,
              );
              const result = await window.electron.transcribeGemini(
                wavBuffer,
                "audio/wav",
                [wavBuffer],
                ts,
              );
              lastApiCallTimestampRef.current = Date.now();
              transcript = result.text;
              timingsFromMain = result.timings || {};
            } else {
              // Fallback to Groq
              if (!window.electron?.transcribeGroq) {
                throw new Error(
                  "Groq transcription service (window.electron.transcribeGroq) is not available.",
                );
              }

              const worker = ensureWavEncoderWorker();
              if (!worker) {
                throw new Error("WAV encoder worker could not be initialized.");
              }

              mark("wav_encode_start");
              const wavResult = await getWavFromWorkerWithTimeout(
                worker,
                trimmedPcmF32,
              );
              mark("wav_encode_end");

              const { wavBuffer } = wavResult;
              console.log(
                `[useTranscription] Sending WAV (${wavBuffer.byteLength} bytes) to Groq...`,
              );

              const result = await window.electron.transcribeGroq(
                wavBuffer,
                [wavBuffer],
                ts,
              );
              lastApiCallTimestampRef.current = Date.now();
              transcript = result.text;
              timingsFromMain = result.timings || {};
            }
            mark("ipc_end");

            const roundTrip = ts.ipc_end - ts.ipc_start;
            const measuredTotal = performance.now() - totalProcessingStart;

            // Loosely typed to handle timings from main process IPC
            const detailedTimings = timingsFromMain as any;

            const pipelineStages = collectPipeline(
              {
                concat: ts.concat_end - ts.concat_start,
                trim: ts.trim_end - ts.trim_start,
              },
              roundTrip,
              detailedTimings,
              measuredTotal,
            );

            console.log(`[useTranscription] Timings for ${cloudEngine}:`);
            console.table(pipelineStages);

            if (profilingStartTimeRef.current) {
              console.log(
                `[useTranscription] Profiling: Cloud Worklet - ${cloudEngine} transcript received.`,
              );
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
            setError(
              (err as Error).message || "Cloud transcription (worklet) failed.",
            );
          } finally {
            setProcessing(false);
          }
        };

        // Trigger the worklet to send back the audio frames
        mark("flush_sent");
        workletNodeRef.current.port.postMessage({ type: "flush" });
      })();
    } else {
      // currentMode === 'local'
      // Existing local mode stop logic
      console.log(
        "[useTranscription] Stopping local recording. Disconnecting AudioWorklet, notifying worker.",
      );

      localTimingRef.current.stopTime = performance.now();

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
if (typeof window !== "undefined" && !window.electron) {
  console.log(
    "[useTranscription] Mocking window.electron API for development/testing.",
  );
  (window as Window & { electron: Window["electron"] }).electron = {
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
    ): Promise<{ text: string; timings: Record<string, number> }> => {
      console.warn(
        `[Mock Electron] transcribeGroq called with ArrayBuffer (length: ${audioBuffer.byteLength}). Upstream timings:`,
        upstreamTimings,
      );
      // const cloudEngine = 'groq'; // This would need to be available in this scope or passed
      const mockMainTimings = {
        main_pack: Math.random() * 10,
        main_to_worker: Math.random() * 50,
        worker_groq_api: Math.random() * 600,
        worker_to_main: Math.random() * 50,
        main_to_renderer: Math.random() * 1,
      };
      return new Promise((resolve) =>
        setTimeout(() => {
          resolve({
            text: "Mocked Groq transcript from window.electron mock.",
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
    warmUpConnection: (engine: "groq" | "gemini") => {
      console.log(`[Mock Electron] warmUpConnection called for ${engine}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onPTTDown: (cb: () => void) => {
      console.log("[Mock Electron] onPTTDown called");
      return () => console.log("[Mock Electron] cleanup onPTTDown");
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onPTTUp: (cb: () => void) => {
      console.log("[Mock Electron] onPTTUp called");
      return () => console.log("[Mock Electron] cleanup onPTTUp");
    },
  };
}
