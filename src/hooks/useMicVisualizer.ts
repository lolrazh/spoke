/**
 * Microphone Visualizer Hook
 *
 * Manages Web Audio API capture and device selection for a microphone check UI.
 * Exposes the live AnalyserNode via a ref so the per-frame bar animation can be
 * driven from a leaf component (see MicBars), keeping 60 Hz updates off the hook
 * consumer's render path.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { AUDIO_PROCESSING_TRACK_CONSTRAINTS } from "../config/audioConstraints";
import { DEFAULT_MICROPHONE } from "../utils/microphoneDevices";

export function useMicVisualizer(options: {
  /** Whether the visualizer is currently active (e.g., on the mic-check step) */
  active: boolean;
}) {
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const captureGenerationRef = useRef(0);

  const [micDevices, setMicDevices] = useState<
    Array<{ id: string; label: string }>
  >([DEFAULT_MICROPHONE]);
  const [selectedMicId, setSelectedMicId] = useState<string>("default");

  const stopMic = useCallback(() => {
    captureGenerationRef.current += 1;
    try {
      analyserRef.current?.disconnect();
    } catch {}
    analyserRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
    try {
      micStreamRef.current?.getTracks()?.forEach((t) => t.stop());
    } catch {}
    micStreamRef.current = null;
  }, []);

  const startMic = useCallback(async () => {
    stopMic();
    const generation = captureGenerationRef.current;

    try {
      try {
        if (selectedMicId) window.mic?.select?.(selectedMicId);
      } catch {}
      let browserDeviceId: string | null = null;
      if (selectedMicId && selectedMicId !== DEFAULT_MICROPHONE.id) {
        const selectedDevice = micDevices.find(
          (device) => device.id === selectedMicId,
        );
        const browserDevices = await navigator.mediaDevices.enumerateDevices();
        if (captureGenerationRef.current !== generation) return;
        browserDeviceId =
          browserDevices.find(
            (device) =>
              device.kind === "audioinput" &&
              (device.deviceId === selectedMicId ||
                (!!selectedDevice && device.label === selectedDevice.label)),
          )?.deviceId ?? null;
      }
      const constraints: MediaStreamConstraints = {
        video: false,
        audio: browserDeviceId
          ? {
              deviceId: { exact: browserDeviceId },
              ...AUDIO_PROCESSING_TRACK_CONSTRAINTS,
            }
          : { ...AUDIO_PROCESSING_TRACK_CONSTRAINTS },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (captureGenerationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      micStreamRef.current = stream;
      const Ctor = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio API not supported");
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.85;
      src.connect(analyser);
      analyserRef.current = analyser;
    } catch (e) {
      if (captureGenerationRef.current !== generation) return;
      stopMic();
      const isDev = import.meta.env.MODE === "development";
      if (isDev) console.error("[MicVisualizer] startMic failed:", e);
    }
  }, [micDevices, selectedMicId, stopMic]);

  // Start/stop based on active flag
  useEffect(() => {
    if (options.active) {
      void startMic();
      return () => stopMic();
    }
    stopMic();
  }, [options.active, startMic, stopMic]);

  return {
    analyserRef,
    micDevices,
    setMicDevices,
    selectedMicId,
    setSelectedMicId,
  };
}
