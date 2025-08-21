import { useRef, useState, useEffect, useCallback } from "react";
import { playToggleOn, playToggleOff } from "../utils/audioFeedback";
import {
  MICROPHONE_PREFERRED_RATE,
  TARGET_SAMPLE_RATE,
  SAMPLES_PER_CHUNK,
  WS_MAX_BUFFERED_BYTES,
} from "../config/audio";
import { getTranscribeWsUrl } from "../config/api";
import { concatInt16, encodeWavInt16, encodeFrameHeader } from "../utils/pcm";

// Define the hook's return type
export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  text: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  cancel: () => void;
}

export interface UseTranscriptionOptions {
  /**
   * When true (default), the hook will enumerate audio devices on mount and on device changes.
   * This requires getUserMedia to obtain device labels on macOS and may trigger a permission prompt.
   */
  autoEnumerateDevices?: boolean;
  /**
   * When true (default), the hook will open a microphone stream automatically based on the
   * currently selected device. When false, a stream will only be opened on start().
   */
  autoInitStream?: boolean;
  /**
   * When true, request mic permission during device enumeration to fetch device labels.
   * Defaults to false to avoid opening the mic until dictation starts.
   */
  requestLabelPermissionForEnumeration?: boolean;
}

export function useTranscription(
  options?: UseTranscriptionOptions,
): UseTranscriptionReturn {
  const {
    autoEnumerateDevices = true,
    autoInitStream = true,
    requestLabelPermissionForEnumeration = false,
  } = options ?? {};
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pcmChunksRef = useRef<Int16Array[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Streaming v2 state
  const wsRef = useRef<WebSocket | null>(null);
  const wsReadyRef = useRef(false);
  const wsErrorRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const sendQueueRef = useRef<ArrayBuffer[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const useStreamingRef = useRef<boolean>(false);
  const startedMsRef = useRef<number>(0);

  const nowRelNs = () => {
    try {
      const relMs = Math.max(0, performance.now() - startedMsRef.current);
      return BigInt(Math.round(relMs * 1e6));
    } catch {
      return BigInt(0);
    }
  };

  const flushQueue = useCallback(() => {
    if (!wsRef.current || !wsReadyRef.current) return;
    const ws = wsRef.current;
    while (sendQueueRef.current.length) {
      if (ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) break;
      const next = sendQueueRef.current.shift()!;
      try { ws.send(next); } catch {}
    }
    if (sendQueueRef.current.length && ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
      if (flushTimerRef.current == null) {
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null;
          flushQueue();
        }, 10);
      }
    }
  }, []);

  const ensureStreamingSocket = useCallback(() => {
    if (wsRef.current) return;
    const wsUrl = getTranscribeWsUrl();
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    wsReadyRef.current = false;
    wsErrorRef.current = null;

    ws.onopen = () => {
      wsReadyRef.current = true;
      try {
        const startMsg = { type: "start", version: 2 as const, format: "pcm16le" as const, rate: TARGET_SAMPLE_RATE, language: "en" };
        ws.send(JSON.stringify(startMsg));
      } catch {}
      flushQueue();
    };
    ws.onerror = () => {
      wsErrorRef.current = "WebSocket error";
    };
    ws.onclose = () => {
      wsReadyRef.current = false;
    };
  }, [flushQueue]);

  const streamFrame = useCallback((pcmBuf: ArrayBuffer) => {
    if (!useStreamingRef.current) return;
    // Build header + payload into a single ArrayBuffer
    const payload = new Uint8Array(pcmBuf);
    const header = encodeFrameHeader(seqRef.current++, payload.byteLength, nowRelNs());
    const out = new Uint8Array((header.byteLength || 16) + payload.byteLength);
    out.set(new Uint8Array(header), 0);
    out.set(payload, (header.byteLength || 16));

    const ws = wsRef.current;
    if (ws && wsReadyRef.current && ws.bufferedAmount <= WS_MAX_BUFFERED_BYTES) {
      try { ws.send(out.buffer); } catch { sendQueueRef.current.push(out.buffer); }
    } else {
      sendQueueRef.current.push(out.buffer);
      ensureStreamingSocket();
      flushQueue();
    }
  }, [flushQueue, ensureStreamingSocket]);

  const waitForAllFramesSent = useCallback(async (timeoutMs = 1500) => {
    const start = Date.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        flushQueue();
        const ws = wsRef.current;
        if (!ws || !wsReadyRef.current) return resolve();
        if (sendQueueRef.current.length === 0 && ws.bufferedAmount === 0) return resolve();
        if (Date.now() - start > timeoutMs) return resolve();
        setTimeout(tick, 10);
      };
      tick();
    });
  }, [flushQueue]);

  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedMicId, setSelectedMicId] = useState<string>("default");

  // Device enumeration function
  const enumerateAndSendDevices = useCallback(async () => {
    try {
      // Avoid opening the mic by default; only request permission for labels if explicitly asked
      if (requestLabelPermissionForEnumeration) {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop tracks to prevent persistent capture
        tempStream.getTracks().forEach((track) => track.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device) => ({
          id: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
        }));

      console.log("[useTranscription] Found audio input devices:", audioInputs);

      // Send to main process with a small delay to ensure tray is ready
      setTimeout(() => {
        if (window.mic?.updateDevices) {
          console.log(
            "[useTranscription] Sending devices to main process:",
            audioInputs,
          );
          window.mic.updateDevices(audioInputs, selectedMicId);
        }
      }, 500);
    } catch (err) {
      console.error("[useTranscription] Failed to enumerate devices:", err);
    }
  }, [selectedMicId, requestLabelPermissionForEnumeration]);

  // Enumerate and send available microphones to main process
  useEffect(() => {
    if (!autoEnumerateDevices) {
      return;
    }
    enumerateAndSendDevices();

    // Listen for device changes (plug/unplug)
    const handleDeviceChange = () => {
      console.log(
        "[useTranscription] Device change detected, re-enumerating...",
      );
      // Add a small delay to let the system settle after device changes
      setTimeout(() => {
        enumerateAndSendDevices();
      }, 200);
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [enumerateAndSendDevices, autoEnumerateDevices]);

  // Listen for microphone selection changes from main process
  useEffect(() => {
    if (!window.mic?.onSelectedChanged) return;

    const unsubscribe = window.mic.onSelectedChanged(({ id }) => {
      console.log("[useTranscription] Microphone selection changed to:", id);
      setSelectedMicId(id);
    });

    return unsubscribe;
  }, []);

  // Listen for refresh requests from main process
  useEffect(() => {
    if (!window.mic?.onRefreshRequest) return;

    const unsubscribe = window.mic.onRefreshRequest(() => {
      console.log(
        "[useTranscription] ✅ Refresh devices requested from main process - executing refresh...",
      );
      if (autoEnumerateDevices) {
        enumerateAndSendDevices();
      }
    });

    return unsubscribe;
  }, [enumerateAndSendDevices, autoEnumerateDevices]);

  // Helper to open a microphone stream for the currently selected device
  const openStreamForSelectedDevice = useCallback(async (): Promise<boolean> => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          sampleRate: MICROPHONE_PREFERRED_RATE,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
        },
      };

      if (selectedMicId !== "default") {
        (constraints.audio as MediaTrackConstraints).deviceId = {
          exact: selectedMicId,
        };
      }

      console.log(
        "[useTranscription] Opening microphone stream with constraints:",
        constraints,
      );
      streamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
      setReady(true);
      setError(null);
      console.log(
        "[useTranscription] Microphone stream opened successfully",
      );
      return true;
    } catch (err) {
      console.error("[useTranscription] Failed to open microphone stream:", err);
      setError(
        "Microphone permissions denied or selected microphone not available.",
      );
      setReady(false);
      return false;
    }
  }, [selectedMicId]);

  // Initialize microphone stream when selected device changes
  useEffect(() => {
    if (!autoInitStream) {
      return;
    }
    const initializeMicrophone = async () => {
      // Stop existing stream if any
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setReady(false);
      }

      await openStreamForSelectedDevice();
    };

    initializeMicrophone();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [selectedMicId, autoInitStream, openStreamForSelectedDevice]);

  const start = useCallback(async () => {
    if (recording) return;
    if (processing) return; // Prevent starting while processing
    if (!streamRef.current) {
      const ok = await openStreamForSelectedDevice();
      if (!ok) return;
    }

    playToggleOn();
    setError(null);
    setText("");
    setRecording(true);
    pcmChunksRef.current = [];
    // Reset streaming state (streaming always on by default)
    useStreamingRef.current = true;
    seqRef.current = 0;
    sendQueueRef.current = [];
    wsErrorRef.current = null;
    wsReadyRef.current = false;
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    startedMsRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    try {
      // Create AudioContext at device/hardware rate and attach downsampler worklet
      audioContextRef.current = new AudioContext();
      await audioContextRef.current.audioWorklet.addModule(
        "/worklets/pcm16-downsampler.worklet.js",
      );

      sourceNodeRef.current = audioContextRef.current.createMediaStreamSource(
        streamRef.current,
      );
      workletNodeRef.current = new AudioWorkletNode(
        audioContextRef.current,
        "pcm16-downsampler",
        {
          processorOptions: {
            targetSampleRate: TARGET_SAMPLE_RATE,
            frameSamples: SAMPLES_PER_CHUNK,
          },
        },
      );

      workletNodeRef.current.port.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as any;
        if (msg?.type === "audio" && msg?.samples) {
          const buf: ArrayBuffer = msg.samples as ArrayBuffer;
          pcmChunksRef.current.push(new Int16Array(buf));
          // Stream immediately when enabled (keep local copy for v1 fallback)
          streamFrame(buf);
        }
      };

      // Connect source -> worklet (silent path)
      sourceNodeRef.current.connect(workletNodeRef.current);
      if (useStreamingRef.current) {
        ensureStreamingSocket();
      }

      if (window.devFlags?.devConsoleLogs) {
        console.info("[SF] AudioContext (PCM capture)", {
          actualRate: audioContextRef.current.sampleRate,
          targetRate: TARGET_SAMPLE_RATE,
          samplesPerChunk: SAMPLES_PER_CHUNK,
        });
      }
    } catch (err) {
      setError((err as Error).message);
      setRecording(false);
    }
  }, [recording, processing, openStreamForSelectedDevice, streamFrame]);

  const stop = useCallback(async () => {
    if (!recording) return;

    playToggleOff();
    setRecording(false);
    setProcessing(true);

    try {
      // Disconnect nodes
      // Ask the worklet to flush any partial frame before tearing down
      try { workletNodeRef.current?.port.postMessage({ type: "flush" }); } catch {}
      // Disconnect nodes
      try { sourceNodeRef.current?.disconnect(); } catch {}
      try { workletNodeRef.current?.port.postMessage({ type: "reset" }); } catch {}
      try { workletNodeRef.current?.disconnect(); } catch {}
      // Close AudioContext to release mic indicator faster
      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }

      // Stop capturing audio completely so macOS mic indicator turns off
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setReady(false);
      }
      // Streaming v2 path (send frames during capture, then finalize)
      if (useStreamingRef.current) {
        // Ensure socket exists; if not, fall back to v1 below
        if (!wsRef.current || wsErrorRef.current) {
          if (window.devFlags?.devConsoleLogs) {
            console.warn("[SF] WS streaming not ready, falling back to v1");
          }
        } else {
          // Flush any queued frames and signal end; wait for final
          abortControllerRef.current = new AbortController();
          await new Promise<void>((resolve, reject) => {
            let resolved = false;
            const ws = wsRef.current!;
            const onAbort = () => {
              if (!resolved) {
                resolved = true;
                try { ws.close(); } catch {}
                reject(new DOMException("Aborted", "AbortError"));
              }
            };
            abortControllerRef.current!.signal.addEventListener('abort', onAbort);

            ws.onmessage = (event) => {
              try {
                const msg = JSON.parse(String(event.data));
                if (msg.type === "status" && msg.state === "processing") {
                  if (window.devFlags?.devConsoleLogs) console.info("[SF] Transcribe processing started");
                } else if (msg.type === "final") {
                  if (!resolved) {
                    resolved = true;
                    setText(msg.text || "");
                    if (msg.text) {
                      window.transcript?.update(msg.text);
                      window.clipboard.insertText(msg.text);
                    }
                    resolve();
                  }
                } else if (msg.type === "error") {
                  if (!resolved) {
                    resolved = true;
                    reject(new Error(`Server error: ${msg.body || 'Unknown error'}`));
                  }
                }
              } catch {}
            };
            ws.onerror = () => {
              if (!resolved) {
                resolved = true;
                reject(new Error("WebSocket connection error"));
              }
            };
            ws.onclose = () => {
              if (!resolved) {
                resolved = true;
                reject(new Error("WebSocket closed unexpectedly"));
              }
            };
            // Kick a final flush, wait for queue drain, then send end
            (async () => {
              try {
                await waitForAllFramesSent();
              } catch {}
              try { ws.send(JSON.stringify({ type: "end" })); } catch {}
            })();
          });
          // Clean up WS after final
          try { wsRef.current?.close(); } catch {}
          wsRef.current = null;
          return; // Done; skip v1 path
        }
      }

      // v1 fallback path: combine PCM to WAV and send once
      const pcm = concatInt16(pcmChunksRef.current);
      const wav = encodeWavInt16(pcm, TARGET_SAMPLE_RATE);
      const audioBlob = new Blob([wav], { type: "audio/wav" });

      if (window.devFlags?.devConsoleLogs) {
        console.info("[SF] Audio blob (PCM16/WAV)", {
          sizeKB: Number((audioBlob.size / 1024).toFixed(2)),
          type: audioBlob.type,
          frames: pcmChunksRef.current.length,
          samples: pcm.length,
        });
      }

      const wsUrl = getTranscribeWsUrl();
      if (window.devFlags?.devConsoleLogs) {
        console.info("[SF] Transcribe WebSocket request", { url: wsUrl });
      }

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      abortControllerRef.current = new AbortController();
      await new Promise<void>((resolve, reject) => {
        let resolved = false;
        abortControllerRef.current!.signal.addEventListener('abort', () => {
          if (!resolved) {
            resolved = true;
            ws.close();
            reject(new DOMException("Aborted", "AbortError"));
          }
        });
        ws.onopen = async () => {
          try {
            ws.send(JSON.stringify({ type: "start", language: "en" }));
            ws.send(await audioBlob.arrayBuffer());
            ws.send(JSON.stringify({ type: "end" }));
          } catch (err) {
            if (!resolved) { resolved = true; reject(err); }
          }
        };
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data));
            if (msg.type === "status" && msg.state === "processing") {
              if (window.devFlags?.devConsoleLogs) console.info("[SF] Transcribe processing started");
            } else if (msg.type === "final") {
              if (!resolved) {
                resolved = true;
                setText(msg.text || "");
                if (msg.text) {
                  window.transcript?.update(msg.text);
                  window.clipboard.insertText(msg.text);
                }
                resolve();
              }
            } else if (msg.type === "error") {
              if (!resolved) { resolved = true; reject(new Error(`Server error: ${msg.body || 'Unknown error'}`)); }
            }
          } catch {}
        };
        ws.onerror = () => { if (!resolved) { resolved = true; reject(new Error("WebSocket connection error")); } };
        ws.onclose = () => { if (!resolved) { resolved = true; reject(new Error("WebSocket closed unexpectedly")); } };
      });
    } catch (err) {
      // Swallow aborts quietly; surface other errors
      if ((err as DOMException)?.name === "AbortError") {
        // No-op: canceled by user
      } else {
        if (window.devFlags?.devConsoleLogs) {
          console.error("[SF] Transcribe exception", { error: (err as Error)?.message });
        }
        setError((err as Error).message);
      }
    } finally {
      setProcessing(false);
      pcmChunksRef.current = [];
      workletNodeRef.current = null;
      sourceNodeRef.current = null;
      abortControllerRef.current = null;
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
    }
  }, [recording]);

  const cancel = useCallback(async () => {
    // Cancel only affects active recordings; it does not send audio to the API
    if (!recording && !audioContextRef.current && !streamRef.current) {
      // Also abort any in-flight processing if present
      if (abortControllerRef.current) {
        try { abortControllerRef.current.abort(); } catch {}
        abortControllerRef.current = null;
      }
      return;
    }

    try {
      // Disconnect nodes and clean up (discard captured audio)
      try { sourceNodeRef.current?.disconnect(); } catch {}
      try { workletNodeRef.current?.disconnect(); } catch {}
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }

      // Stop capturing audio completely
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch {}
        streamRef.current = null;
        setReady(false);
      }

      // Discard any accumulated PCM frames (scrap the audio)
      pcmChunksRef.current = [];
      // Abort any in-flight processing (if cancel is invoked during processing)
      if (abortControllerRef.current) {
        try { abortControllerRef.current.abort(); } catch {}
        abortControllerRef.current = null;
      }
      // If streaming v2 is active, notify server and close WS
      if (useStreamingRef.current && wsRef.current) {
        try { wsRef.current.send(JSON.stringify({ type: "cancel" })); } catch {}
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
        sendQueueRef.current = [];
        wsReadyRef.current = false;
      }
    } finally {
      // Ensure UI reflects cancellation immediately
      setRecording(false);
      setProcessing(false);
      workletNodeRef.current = null;
      sourceNodeRef.current = null;
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
    }
  }, [recording]);

  return {
    recording,
    processing,
    ready,
    text,
    error,
    start,
    stop,
    cancel,
  };
}
