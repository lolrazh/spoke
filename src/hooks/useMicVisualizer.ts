/**
 * Microphone Visualizer Hook
 *
 * Manages Web Audio API capture, frequency analysis, and visualizer state
 * for a microphone check UI. Provides bar values (0-1), speaking detection,
 * and device selection.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { AUDIO_PROCESSING_TRACK_CONSTRAINTS } from "../config/audioConstraints";

const NUM_BARS = 24;
const SPEAKING_THRESHOLD = 14;

export function useMicVisualizer(options: {
  /** Whether the visualizer is currently active (e.g., on the mic-check step) */
  active: boolean;
}) {
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const [barValues, setBarValues] = useState<number[]>(
    Array.from({ length: NUM_BARS }, () => 0),
  );
  const [speakingDetected, setSpeakingDetected] = useState(false);
  const [micDevices, setMicDevices] = useState<
    Array<{ id: string; label: string }>
  >([{ id: "default", label: "System Default" }]);
  const [selectedMicId, setSelectedMicId] = useState<string>("default");

  const stopMic = useCallback(() => {
    try {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
    } catch {}
    rafIdRef.current = null;
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
    try {
      stopMic();
      const constraints: MediaStreamConstraints = {
        video: false,
        audio:
          selectedMicId && selectedMicId !== "default"
            ? {
                deviceId: { exact: selectedMicId },
                ...AUDIO_PROCESSING_TRACK_CONSTRAINTS,
              }
            : { ...AUDIO_PROCESSING_TRACK_CONSTRAINTS },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStreamRef.current = stream;
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio API not supported");
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.85;
      src.connect(analyser);
      analyserRef.current = analyser;

      const freqData = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(freqData);
        const buckets: number[] = new Array(NUM_BARS).fill(0);
        const binsPerBar = Math.max(1, Math.floor(freqData.length / NUM_BARS));
        let energy = 0;
        for (let i = 0; i < NUM_BARS; i++) {
          let sum = 0;
          const start = i * binsPerBar;
          const end = Math.min(freqData.length, start + binsPerBar);
          for (let j = start; j < end; j++) sum += freqData[j];
          const avg = sum / (end - start || 1);
          buckets[i] = avg / 255;
          energy += avg;
        }
        const avgEnergy = energy / freqData.length;
        setSpeakingDetected((prev) =>
          avgEnergy > SPEAKING_THRESHOLD ? true : prev,
        );
        setBarValues(buckets);
        rafIdRef.current = requestAnimationFrame(tick);
      };
      rafIdRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setSpeakingDetected(false);
      const isDev =
        typeof import.meta !== "undefined" &&
        (import.meta as any).env?.MODE === "development";
      if (isDev) console.error("[MicVisualizer] startMic failed:", e);
    }
  }, [selectedMicId, stopMic]);

  // Start/stop based on active flag
  useEffect(() => {
    if (options.active) {
      startMic();
      return () => stopMic();
    }
    stopMic();
  }, [options.active, startMic, stopMic]);

  // Restart capture when device changes while active
  useEffect(() => {
    if (!options.active) return;
    startMic();
    try {
      if (selectedMicId) window.mic?.select?.(selectedMicId);
    } catch {}
  }, [selectedMicId, options.active, startMic]);

  return {
    barValues,
    speakingDetected,
    micDevices,
    setMicDevices,
    selectedMicId,
    setSelectedMicId,
  };
}
