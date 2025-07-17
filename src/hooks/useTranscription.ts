import { useRef, useState, useEffect, useCallback } from "react";
import { playToggleOn, playToggleOff } from "../utils/audioFeedback";
import {
  TARGET_AUDIO_CONTEXT_RATE,
  MICROPHONE_PREFERRED_RATE,
} from "../config/audio";
import { pcm16ToWav } from "../utils/pcm16-to-wav";

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
  const audioChunksRef = useRef<Int16Array[]>([]);

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
    audioChunksRef.current = [];

    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext({
          sampleRate: TARGET_AUDIO_CONTEXT_RATE,
        });
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }

      const workletPath = new URL(
        "../../public/audioworklet-processor.js",
        import.meta.url,
      ).toString();
      if (!workletRegistry.has(workletPath)) {
        await audioCtxRef.current.audioWorklet.addModule(workletPath);
        workletRegistry.add(workletPath);
      }

      microphoneSourceRef.current = audioCtxRef.current.createMediaStreamSource(
        streamRef.current,
      );
      workletNodeRef.current = new AudioWorkletNode(
        audioCtxRef.current,
        "capture-processor",
      );

      workletNodeRef.current.port.onmessage = (event) => {
        audioChunksRef.current.push(new Int16Array(event.data));
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
      microphoneSourceRef.current?.disconnect();
      workletNodeRef.current?.disconnect();

      const totalLength = audioChunksRef.current.reduce(
        (acc, chunk) => acc + chunk.length,
        0,
      );
      const concatenated = new Int16Array(totalLength);
      let offset = 0;
      for (const chunk of audioChunksRef.current) {
        concatenated.set(chunk, offset);
        offset += chunk.length;
      }

      const wavBlob = pcm16ToWav(concatenated);

      const formData = new FormData();
      formData.append("file", wavBlob, "audio.wav");
      formData.append("model", "distil-whisper-large-v3-en");
      formData.append("language", "en");
      formData.append("response_format", "json");
      formData.append("temperature", "0");

      const response = await fetch("https://api.sonicflow.app", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${errorText}`);
      }

      const result = await response.json();
      setText(result.text);
      if (result.text) {
        window.clipboard.insertText(result.text);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessing(false);
      audioChunksRef.current = [];
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
