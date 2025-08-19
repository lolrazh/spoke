import { useRef, useState, useEffect, useCallback } from "react";
import { playToggleOn, playToggleOff } from "../utils/audioFeedback";
import { MICROPHONE_PREFERRED_RATE } from "../config/audio";
// Lean WS-only path: no connection manager, no keepalive

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
  /** Enable WebSocket streaming path (default: false). */
  useWebSocket?: boolean;
  /** WebSocket URL for transcription (default: wss://api.sonicflow.app/transcribe). */
  wsUrl?: string;
  /** PCM batching window in ms for WS messages (default: 100). */
  wsFrameBatchMs?: number;
  /** Enable real-time transcription updates (default: true). */
  realTimeUpdates?: boolean;
}

export function useTranscription(
  options?: UseTranscriptionOptions,
): UseTranscriptionReturn {
  const {
    autoEnumerateDevices = true,
    autoInitStream = true,
    requestLabelPermissionForEnumeration = false,
    useWebSocket = false,
    wsUrl = "wss://api.sonicflow.app/transcribe",
    wsFrameBatchMs = 100,
    realTimeUpdates = true,
  } = options ?? {};
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReadyRef = useRef<boolean>(false);
  const wsFinalResolverRef = useRef<(() => void) | null>(null);
  const wsClosedRef = useRef<boolean>(false);
  // AudioWorklet path refs (PCM16LE streaming)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const pcmAggregateRef = useRef<Uint8Array[]>([]);
  const pcmBytesRef = useRef<number>(0);
  const pcmTargetBytesRef = useRef<number>(0);

  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedMicId, setSelectedMicId] = useState<string>("default");

  // No connection warming in lean mode

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
    pcmAggregateRef.current = [];
    pcmBytesRef.current = 0;

    try {
      if (!useWebSocket) {
        throw new Error('WebSocket transcription is disabled');
      }

      // Open a fresh WebSocket connection (lean: no pooling, no keepalive)
      wsClosedRef.current = false;
      wsReadyRef.current = false;
      wsRef.current = new WebSocket(wsUrl);

      // Handle server messages
      wsRef.current.addEventListener('message', (evt) => {
        try {
          const msg = JSON.parse(String(evt.data));
          if (msg?.type === 'ready') {
            wsReadyRef.current = true;
          }
          if (msg?.type === 'final') {
            setText(String(msg.text || ''));
            if (msg.text) {
              try { window.transcript?.update(String(msg.text)); } catch {}
              try { window.clipboard.insertText(String(msg.text)); } catch {}
            }
            if (wsFinalResolverRef.current) wsFinalResolverRef.current();
          }
          if (msg?.type === 'error') {
            setError(String(msg.message || 'WebSocket error'));
            if (wsFinalResolverRef.current) wsFinalResolverRef.current();
          }
        } catch {
          // Ignore non-JSON frames (we only expect JSON control)
        }
      });
      wsRef.current.addEventListener('close', () => { 
        wsClosedRef.current = true;
        console.log('[useTranscription] WebSocket connection closed');
      });
      wsRef.current.addEventListener('error', (error) => { 
        console.error('[useTranscription] WebSocket error:', error);
        setError('WebSocket connection error'); 
        if (wsFinalResolverRef.current) wsFinalResolverRef.current();
      });

      // When socket opens, send start meta, then begin AudioWorklet capture
      wsRef.current.addEventListener('open', async () => {
        try {
          wsRef.current?.send(JSON.stringify({
            type: 'start',
            model: 'whisper-large-v3-turbo',
            language: 'en',
            format: 'pcm16le',
            sampleRate: 16000,
            channels: 1,
            bits: 16,
          }));

          // Prepare AudioWorklet; processor handles resampling to 16kHz automatically
          audioContextRef.current = new AudioContext();
          await audioContextRef.current.audioWorklet.addModule('/audioworklet-processor.js');
          const source = audioContextRef.current.createMediaStreamSource(streamRef.current!);
          const worklet = new AudioWorkletNode(audioContextRef.current, 'capture-processor');
          source.connect(worklet);
          // Ensure the graph is pulled without audible output
          const silent = audioContextRef.current.createGain();
          silent.gain.value = 0;
          worklet.connect(silent);
          silent.connect(audioContextRef.current.destination);
          sourceNodeRef.current = source;
          workletNodeRef.current = worklet;

          // Batch PCM frames to roughly wsFrameBatchMs
          const bytesPerSecond = 16000 * 1 * (16 / 8);
          pcmTargetBytesRef.current = Math.max(1, Math.floor(bytesPerSecond * (wsFrameBatchMs / 1000)));

          const flushIfReady = () => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
            if (!wsReadyRef.current) return;
            const total = pcmBytesRef.current;
            if (total <= 0) return;
            // Concatenate and send
            const out = new Uint8Array(total);
            let off = 0;
            for (const c of pcmAggregateRef.current) { out.set(c, off); off += c.length; }
            pcmAggregateRef.current = [];
            pcmBytesRef.current = 0;
            try { wsRef.current.send(out.buffer); } catch {}
          };

          worklet.port.onmessage = (evt) => {
            const buf = evt.data as ArrayBuffer;
            const chunk = new Uint8Array(buf);
            pcmAggregateRef.current.push(chunk);
            pcmBytesRef.current += chunk.byteLength;
            if (pcmBytesRef.current >= pcmTargetBytesRef.current) {
              flushIfReady();
            }
          };
        } catch (e) {
          console.error('[useTranscription] Failed to initialize AudioWorklet/WS:', e);
          setError('Audio initialization failed');
          setRecording(false);
        }
      });
    } catch (err) {
      setError((err as Error).message);
      setRecording(false);
    }
  }, [recording, processing, openStreamForSelectedDevice, useWebSocket, wsUrl, wsFrameBatchMs]);

  const stop = useCallback(async () => {
    if (!recording) return;

    playToggleOff();
    setRecording(false);
    setProcessing(true);

    try {
      // Client-side drain: give ~150ms to send any buffered complete frames
      await new Promise((r) => setTimeout(r, 150));

      // With the new worklet, we only receive complete frames, so no partial flushing needed

      // Send end and wait for final
      if (useWebSocket && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const finalPromise = new Promise<void>((resolve) => { wsFinalResolverRef.current = resolve; });
        try { wsRef.current.send(JSON.stringify({ type: 'end' })); } catch {}
        await finalPromise;
      }

      // Now tear down audio graph and stop mic
      try { sourceNodeRef.current?.disconnect(); } catch {}
      try { workletNodeRef.current?.disconnect(); } catch {}
      sourceNodeRef.current = null;
      workletNodeRef.current = null;
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
      if (streamRef.current) {
        try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
        streamRef.current = null;
        setReady(false);
      }
    } catch (err) {
      // Swallow aborts quietly; surface other errors
      setError((err as Error).message);
    } finally {
      setProcessing(false);
      // Cleanup WebSocket
      if (useWebSocket && wsRef.current) {
        try { if (wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close(); } catch {}
        wsRef.current = null;
        wsReadyRef.current = false;
        wsFinalResolverRef.current = null;
      }
    }
  }, [recording, useWebSocket]);

  const cancel = useCallback(async () => {
    // Cancel only affects active recordings; it does not send audio to the API
    if (!recording && !audioContextRef.current && !streamRef.current) {
      return;
    }

    try {
      // Disconnect audio and stop mic
      try { sourceNodeRef.current?.disconnect(); } catch {}
      try { workletNodeRef.current?.disconnect(); } catch {}
      sourceNodeRef.current = null;
      workletNodeRef.current = null;
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch {}
        streamRef.current = null;
        setReady(false);
      }
    } finally {
      // Ensure UI reflects cancellation immediately
      setRecording(false);
      setProcessing(false);
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
