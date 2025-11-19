import React, { useMemo, useEffect, useState } from "react";
import { motion } from "framer-motion";

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

  // Animate the wave continuously when processing
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      setTicker((t) => t + 1);
    }, 33); // Update every 33ms for 10% slower animation

    return () => clearInterval(interval);
  }, [isProcessing]);

  // Smooth transition between listening and processing states
  useEffect(() => {
    const targetBlend = isProcessing ? 1 : (isListening ? 0 : transitionBlend);

    let rafId: number;
    const animate = () => {
      setTransitionBlend(prev => {
        const diff = targetBlend - prev;
        if (Math.abs(diff) < 0.01) return targetBlend;
        // Smooth spring-like interpolation
        return prev + diff * 0.18;
      });
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
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
  const reactiveHeights = useMemo(() => {
    // Dots when neither listening nor processing
    if (!isListening && !isProcessing) {
      return baseHeights.map(() => 3); // Small dots when not active
    }

    // Calculate listening heights (voice-reactive)
    const listeningHeights = baseHeights.map((baseHeight, index) => {
      const variation = Math.sin(Date.now() / 100 + index) * 0.15 + 1;
      const scaledHeight = baseHeight * (0.35 + audioLevel * 2.6) * variation;
      return Math.max(2, Math.min(12, scaledHeight));
    });

    // Calculate processing heights (sine wave)
    const time = ticker / 2;
    const processingHeights = baseHeights.map((baseHeight, index) => {
      const wave = Math.sin(time + index * 0.5) * 0.5 + 0.5;
      const variation = Math.sin(ticker / 4 + index * 0.3) * 0.15 + 1;
      const scaledHeight = baseHeight * (0.35 + wave * 1.8) * variation;
      return Math.max(2, Math.min(9, scaledHeight));
    });

    // Blend between listening and processing based on transition state
    return baseHeights.map((_, index) => {
      const listeningHeight = listeningHeights[index];
      const processingHeight = processingHeights[index];
      return listeningHeight * (1 - transitionBlend) + processingHeight * transitionBlend;
    });
  }, [audioLevel, isListening, isProcessing, ticker, baseHeights, transitionBlend]);

  return (
    <div className="frequency-bars-container">
      {reactiveHeights.map((height, index) => {
        const isBar = isListening || isProcessing;
        const isDot = !isListening && !isProcessing;

        return (
          <motion.div
            key={`freq-${index}`}
            className={`frequency-element ${isDot ? 'as-dot' : 'as-bar'}`}
            animate={{
              height: isDot ? 2 : height,
              width: isDot ? 2 : 2,
              borderRadius: isDot ? '50%' : '1px',
              opacity: isDot ? (isHovered ? 0.8 : 0.6) : 1.0,
            }}
            transition={{
              height: {
                type: "spring",
                stiffness: (isListening || isProcessing) ? 750 : 350,
                damping: (isListening || isProcessing) ? 19 : 28,
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
