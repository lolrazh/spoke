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

  // Animate the wave continuously when processing
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      setTicker((t) => t + 1);
    }, 33); // Update every 33ms for 10% slower animation

    return () => clearInterval(interval);
  }, [isProcessing]);

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
    // Processing state: fast flowing sine wave like listening bars
    if (isProcessing) {
      const time = ticker / 2; // Wave speed
      return baseHeights.map((baseHeight, index) => {
        // Create flowing sine wave with shorter wavelength and variation
        const wave = Math.sin(time + index * 0.8) * 0.5 + 0.5; // Shorter wavelength (0.5 -> 0.8)
        const variation = Math.sin(ticker / 4 + index * 0.3) * 0.15 + 1; // Fast variation
        // Same scaling as listening bars for consistent look
        const scaledHeight = baseHeight * (0.35 + wave * 2.6) * variation;
        return Math.max(2, Math.min(12, scaledHeight));
      });
    }

    if (!isListening) {
      return baseHeights.map(() => 3); // Small dots when not listening
    }

    // Apply audio level with subtle variation for visual interest
    return baseHeights.map((baseHeight, index) => {
      // Reduced variation to prevent jittery appearance at peaks
      const variation = Math.sin(Date.now() / 100 + index) * 0.15 + 1;
      // Natural scaling that works well with logarithmic curve
      const scaledHeight = baseHeight * (0.35 + audioLevel * 2.6) * variation;
      // Reduced max height to 12px (10% less than 14px)
      return Math.max(2, Math.min(12, scaledHeight));
    });
  }, [audioLevel, isListening, isProcessing, ticker, baseHeights]);

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
              opacity: isDot ? (isHovered ? 0.8 : 0.6) : isProcessing ? 0.8 : 0.75 + audioLevel * 0.25,
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
