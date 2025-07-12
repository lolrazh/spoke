import { useRef, useState, useEffect, useCallback } from "react";
import { playToggleOn, playToggleOff } from "../utils/audioFeedback";
import { TARGET_AUDIO_CONTEXT_RATE, MICROPHONE_PREFERRED_RATE } from "../config/audio";

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
}

export function useTranscription(): UseTranscriptionReturn {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const fetchPromiseRef = useRef<Promise<Response> | null>(null);

  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (streamRef.current) return;
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: MICROPHONE_PREFERRED_RATE,
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
          },
        });
        setReady(true);
      } catch (err) {
        setError("Microphone permissions denied or microphone not available.");
        setReady(false);
      }
    })();
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const start = useCallback(async () => {
    if (recording) return;
    if (!streamRef.current) {
      setError("Microphone stream not available.");
      return;
    }

    playToggleOn();
    setError(null);
    setText("");
    setRecording(true);

    try {
      const transformStream = new TransformStream();
      writerRef.current = transformStream.writable.getWriter();

      fetchPromiseRef.current = fetch("https://api.sonicflow.app", {
        method: 'POST',
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: transformStream.readable,
        duplex: 'half',
      });

      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext({ sampleRate: TARGET_AUDIO_CONTEXT_RATE });
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }

      const workletPath = "/audioworklet-processor.js";
      if (!workletRegistry.has(workletPath)) {
        await audioCtxRef.current.audioWorklet.addModule(workletPath);
        workletRegistry.add(workletPath);
      }

      microphoneSourceRef.current = audioCtxRef.current.createMediaStreamSource(streamRef.current);
      workletNodeRef.current = new AudioWorkletNode(audioCtxRef.current, "capture-processor");

      workletNodeRef.current.port.onmessage = (event) => {
        if (writerRef.current) {
          writerRef.current.write(new Uint8Array(event.data));
        }
      };

      microphoneSourceRef.current.connect(workletNodeRef.current);

    } catch (err) {
      setError((err as Error).message);
      setRecording(false);
    }
  }, [recording]);

  const stop = useCallback(async () => {
    if (!recording) return;

    playToggleOff();
    setRecording(false);
    setProcessing(true);

    try {
      if (writerRef.current) {
        await writerRef.current.close();
      }

      if (fetchPromiseRef.current) {
        const response = await fetchPromiseRef.current;
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server error: ${errorText}`);
        }
        const result = await response.json();
        setText(result.text);
        window.electron.insertTextAtCursor(result.text);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessing(false);
      microphoneSourceRef.current?.disconnect();
      workletNodeRef.current?.disconnect();
      writerRef.current = null;
      fetchPromiseRef.current = null;
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
  };
}