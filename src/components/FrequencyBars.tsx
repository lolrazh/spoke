import React, { useMemo, useEffect, useRef, useState } from "react";
import { m } from "framer-motion";
import { useAudioLevel } from "../state/audioLevel";

interface FrequencyBarsProps {
  audioLevel: number; // 0-1 range
  isListening: boolean;
  isIdle?: boolean;
  isHovered?: boolean;
  isProcessing?: boolean;
}

const FrequencyBars: React.FC<FrequencyBarsProps> = ({
  audioLevel,
  isListening,
  isIdle = false,
  isHovered = false,
  isProcessing = false,
}) => {
  // More bars for denser visualization (increased from 7 to 18)
  const barCount = 18;

  // Animation ticker for processing wave
  const [ticker, setTicker] = useState(0);

  // Transition blend: 0 = listening, 1 = processing
  const [transitionBlend, setTransitionBlend] = useState(isProcessing ? 1 : 0);
  // Mirrors transitionBlend so the rAF loop can read the latest value without
  // re-subscribing the effect on every frame.
  const transitionBlendRef = useRef(transitionBlend);

  // Animate the wave continuously when processing
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      setTicker((t) => t + 1);
    }, 33); // Update every 33ms for 10% slower animation

    return () => clearInterval(interval);
  }, [isProcessing]);

  // Smooth transition between listening and processing states. The loop stops
  // itself once the blend converges and only restarts when the target changes
  // (isProcessing/isListening), rather than re-scheduling forever at 60Hz.
  useEffect(() => {
    const targetBlend = isProcessing
      ? 1
      : isListening
        ? 0
        : transitionBlendRef.current;

    let rafId: number | null = null;
    const animate = () => {
      const prev = transitionBlendRef.current;
      const diff = targetBlend - prev;
      if (Math.abs(diff) < 0.01) {
        // Converged: snap to the target and do NOT schedule another frame.
        if (prev !== targetBlend) {
          transitionBlendRef.current = targetBlend;
          setTransitionBlend(targetBlend);
        }
        return;
      }
      // Smooth spring-like interpolation
      const next = prev + diff * 0.18;
      transitionBlendRef.current = next;
      setTransitionBlend(next);
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isProcessing, isListening]);

  // Generate symmetric height pattern for base heights
  const baseHeights = useMemo(() => {
    const heights: number[] = [];
    const mid = Math.floor(barCount / 2);

    for (let i = 0; i < barCount; i++) {
      const distFromCenter = Math.abs(i - mid);
      // Create a smooth curve - taller in middle, shorter at edges
      const normalizedDist = distFromCenter / mid;
      // Reduced height range for 10% less vertical space
      const baseHeight = 2 + (5.4 - 2) * (1 - Math.pow(normalizedDist, 1.5));
      heights.push(baseHeight);
    }

    return heights;
  }, [barCount]);

  // Calculate reactive heights based on audio level
  // Single-pass computation to avoid multiple array allocations per frame
  const reactiveHeights = useMemo(() => {
    // Dots when neither listening nor processing
    if (!isListening && !isProcessing) {
      return baseHeights.map(() => 3); // Small dots when not active
    }

    const time = ticker / 2;
    const now = Date.now();

    // Single pass: compute both listening and processing heights, then blend
    return baseHeights.map((baseHeight, index) => {
      // Listening height calculation (voice-reactive)
      const listeningVariation = Math.sin(now / 100 + index) * 0.15 + 1;
      const listeningScaled =
        baseHeight * (0.35 + audioLevel * 2.6) * listeningVariation;
      const listeningHeight = Math.max(2, Math.min(12, listeningScaled));

      // Processing height calculation (sine wave with layered variation)
      const wave = Math.sin(time + index * 0.5) * 0.5 + 0.5;
      const slowVariation = Math.sin(ticker / 6 + index * 0.4) * 0.12;
      const fastVariation = Math.sin(ticker / 3 + index * 0.8) * 0.08;
      const microVariation = Math.sin(ticker / 2.5 + index * 1.2) * 0.05;
      const totalVariation = 1 + slowVariation + fastVariation + microVariation;
      const processingScaled =
        baseHeight * (0.35 + wave * 1.8) * totalVariation;
      const processingHeight = Math.max(2, Math.min(9, processingScaled));

      // Blend based on transition state
      return (
        listeningHeight * (1 - transitionBlend) +
        processingHeight * transitionBlend
      );
    });
  }, [
    audioLevel,
    isListening,
    isProcessing,
    ticker,
    baseHeights,
    transitionBlend,
  ]);

  return (
    <div className="frequency-bars-container">
      {reactiveHeights.map((height, index) => {
        const isBar = isListening || isProcessing;
        const isDot = !isListening && !isProcessing;

        return (
          <m.div
            key={`freq-${index}`}
            className={`frequency-element ${isDot ? "as-dot" : "as-bar"}`}
            animate={{
              height: isDot ? 2 : height,
              width: isDot ? 2 : 2,
              borderRadius: isDot ? "50%" : "1px",
              opacity: isDot ? (isHovered ? 0.8 : 0.6) : 1.0,
            }}
            transition={{
              height: {
                type: "spring",
                stiffness: isListening || isProcessing ? 750 : 350,
                damping: isListening || isProcessing ? 19 : 28,
                mass: 0.25,
              },
              width: { duration: 0.15 },
              borderRadius: { duration: 0.15 },
              opacity: { duration: 0.1 },
            }}
          />
        );
      })}
    </div>
  );
};

export default FrequencyBars;

/**
 * Listening visualizer that subscribes to the live audio level store directly.
 * Isolating the subscription here means an audio frame (~33x/sec) re-renders
 * only this leaf, not the pill or the app tree.
 */
export const ListeningFrequencyBars: React.FC<
  Omit<FrequencyBarsProps, "audioLevel">
> = (props) => {
  const audioLevel = useAudioLevel();
  return <FrequencyBars audioLevel={audioLevel} {...props} />;
};
