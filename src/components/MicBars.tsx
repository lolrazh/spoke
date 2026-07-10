/**
 * MicBars
 *
 * Leaf visualizer for the onboarding mic-check. It owns the per-frame bar state
 * and runs its own requestAnimationFrame loop off the live AnalyserNode, so the
 * ~60 Hz updates re-render only these bars rather than the whole onboarding tree.
 */

import { useState, useEffect, type RefObject } from "react";

const NUM_BARS = 24;

const zeroBars = () => Array.from({ length: NUM_BARS }, () => 0);

export function MicBars({
  analyserRef,
  active,
}: {
  /** Live analyser from useMicVisualizer; null until the audio graph is built. */
  analyserRef: RefObject<AnalyserNode | null>;
  /** Whether the mic-check step is active; drives the rAF loop. */
  active: boolean;
}) {
  const [barValues, setBarValues] = useState<number[]>(zeroBars);

  useEffect(() => {
    if (!active) {
      setBarValues(zeroBars());
      return;
    }

    let rafId = 0;
    let freqData: Uint8Array<ArrayBuffer> | null = null;

    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        if (!freqData || freqData.length !== analyser.frequencyBinCount) {
          freqData = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freqData);
        const buckets: number[] = new Array(NUM_BARS).fill(0);
        const binsPerBar = Math.max(1, Math.floor(freqData.length / NUM_BARS));
        for (let i = 0; i < NUM_BARS; i++) {
          let sum = 0;
          const start = i * binsPerBar;
          const end = Math.min(freqData.length, start + binsPerBar);
          for (let j = start; j < end; j++) sum += freqData[j];
          const avg = sum / (end - start || 1);
          buckets[i] = avg / 255;
        }
        setBarValues(buckets);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [active, analyserRef]);

  return (
    <div className="w-full max-w-xl h-24 rounded-lg card-floating p-3 flex items-end gap-[6px]">
      {barValues.map((v, i) => {
        const h = Math.max(6, Math.round(6 + v * 80));
        const opacity = 0.45 + v * 0.55;
        return (
          <div
            key={i}
            className="flex-1 rounded-[3px] bg-white/70"
            style={{ height: `${h}px`, opacity }}
            aria-hidden
          />
        );
      })}
    </div>
  );
}
