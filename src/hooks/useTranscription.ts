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
  const [selectedMicId, setSelectedMicId] = useState<string>("default");

  // Device enumeration function
  const enumerateAndSendDevices = useCallback(async () => {
    try {
      // Request permission first to get device labels
      await navigator.mediaDevices.getUserMedia({ audio: true });

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
  }, [selectedMicId]);

  // Enumerate and send available microphones to main process
  useEffect(() => {
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
  }, [enumerateAndSendDevices]);

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
      enumerateAndSendDevices();
    });

    return unsubscribe;
  }, [enumerateAndSendDevices]);

  // Initialize microphone stream when selected device changes
  useEffect(() => {
    const initializeMicrophone = async () => {
      // Stop existing stream if any
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setReady(false);
      }

      try {
        const constraints: MediaStreamConstraints = {
          audio: {
            sampleRate: MICROPHONE_PREFERRED_RATE,
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
          },
        };

        // Add device ID constraint if not "default"
        if (selectedMicId !== "default") {
          (constraints.audio as MediaTrackConstraints).deviceId = {
            exact: selectedMicId,
          };
        }

        console.log(
          "[useTranscription] Requesting microphone with constraints:",
          constraints,
        );
        streamRef.current =
          await navigator.mediaDevices.getUserMedia(constraints);
        setReady(true);
        setError(null);
        console.log(
          "[useTranscription] Microphone stream initialized successfully",
        );
      } catch (err) {
        console.error(
          "[useTranscription] Failed to get microphone stream:",
          err,
        );
        setError(
          "Microphone permissions denied or selected microphone not available.",
        );
        setReady(false);
      }
    };

    initializeMicrophone();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [selectedMicId]);

  const start = useCallback(async () => {
    if (recording) return;
    if (processing) return; // Prevent starting while processing
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
  }, [recording, processing]);

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
      formData.append("model", "whisper-large-v3-turbo");
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
        // Send transcript to main process for context menu copy functionality
        window.transcript?.update(result.text);
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
