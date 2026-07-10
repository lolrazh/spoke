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

export function useMicVisualizer(options: {
  /** Whether the visualizer is currently active (e.g., on the mic-check step) */
  active: boolean;
}) {
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const [micDevices, setMicDevices] = useState<
    Array<{ id: string; label: string }>
  >([{ id: "default", label: "System Default" }]);
  const [selectedMicId, setSelectedMicId] = useState<string>("default");

  const stopMic = useCallback(() => {
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
    } catch (e) {
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

  // Restart capture when the selected device changes while active. The active
  // effect above already builds the graph on the first run (and rebuilds it
  // whenever startMic's identity changes), so skip this effect's own startMic on
  // the initial run to avoid constructing the audio graph twice on mount.
  const deviceEffectPrimed = useRef(false);
  useEffect(() => {
    if (!options.active) return;
    try {
      if (selectedMicId) window.mic?.select?.(selectedMicId);
    } catch {}
    if (!deviceEffectPrimed.current) {
      deviceEffectPrimed.current = true;
      return;
    }
    startMic();
  }, [selectedMicId, options.active, startMic]);

  return {
    analyserRef,
    micDevices,
    setMicDevices,
    selectedMicId,
    setSelectedMicId,
  };
}
