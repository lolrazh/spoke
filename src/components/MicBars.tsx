/**
 * MicBars
 *
 * Leaf visualizer for the onboarding mic-check. It owns the per-frame bar state
 * and runs its own requestAnimationFrame loop off the live AnalyserNode. The
 * ~60 Hz updates mutate the existing bars, so they do not re-render the
 * onboarding tree.
 */

import { useEffect, useRef, type RefObject } from "react";

const NUM_BARS = 24;
const RESTING_BAR_HEIGHT = 6;
const MAX_BAR_HEIGHT = RESTING_BAR_HEIGHT + 80;
const RESTING_BAR_OPACITY = 0.45;

export function MicBars({
  analyserRef,
  active,
}: {
  /** Live analyser from useMicVisualizer; null until the audio graph is built. */
  analyserRef: RefObject<AnalyserNode | null>;
  /** Whether the mic-check step is active; drives the rAF loop. */
  active: boolean;
}) {
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const resetBars = () => {
      const bars = barsRef.current?.children;
      if (!bars) return;
      for (let index = 0; index < bars.length; index += 1) {
        const bar = bars[index] as HTMLElement;
        bar.style.transform = `scaleY(${RESTING_BAR_HEIGHT / MAX_BAR_HEIGHT})`;
        bar.style.opacity = `${RESTING_BAR_OPACITY}`;
      }
    };

    if (!active) {
      resetBars();
      return;
    }

    let rafId: number | null = null;
    let freqData: Uint8Array<ArrayBuffer> | null = null;

    const tick = () => {
      const analyser = analyserRef.current;
      const bars = barsRef.current?.children;
      if (analyser && bars) {
        if (!freqData || freqData.length !== analyser.frequencyBinCount) {
          freqData = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freqData);
        const binsPerBar = Math.max(1, Math.floor(freqData.length / NUM_BARS));
        for (let i = 0; i < NUM_BARS; i++) {
          let sum = 0;
          const start = i * binsPerBar;
          const end = Math.min(freqData.length, start + binsPerBar);
          for (let j = start; j < end; j++) sum += freqData[j];
          const avg = sum / (end - start || 1);
          const value = avg / 255;
          const bar = bars[i] as HTMLElement;
          const height = Math.max(
            RESTING_BAR_HEIGHT,
            Math.round(RESTING_BAR_HEIGHT + value * 80),
          );
          bar.style.transform = `scaleY(${height / MAX_BAR_HEIGHT})`;
          bar.style.opacity = `${0.45 + value * 0.55}`;
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [active, analyserRef]);

  return (
    <div
      ref={barsRef}
      className="w-full max-w-xl h-24 rounded-lg card-floating p-3 flex items-end gap-[6px]"
    >
      {Array.from({ length: NUM_BARS }, (_, index) => (
        <div
          key={index}
          className="flex-1 rounded-[3px] bg-white/70"
          style={{
            height: `${MAX_BAR_HEIGHT}px`,
            transform: `scaleY(${RESTING_BAR_HEIGHT / MAX_BAR_HEIGHT})`,
            transformOrigin: "bottom",
            opacity: RESTING_BAR_OPACITY,
          }}
          aria-hidden
        />
      ))}
    </div>
  );
}
