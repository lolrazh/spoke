import React, { useMemo } from "react";
import { motion } from "framer-motion";

interface FrequencyBarsProps {
  audioLevel: number; // 0-1 range
  isListening: boolean;
  isIdle?: boolean;
  isHovered?: boolean;
}

const FrequencyBars: React.FC<FrequencyBarsProps> = ({
  audioLevel,
  isListening,
  isIdle = false,
  isHovered = false,
}) => {
  // More bars for denser visualization (increased from 7 to 18)
  const barCount = 18;

  // Generate symmetric height pattern for base heights
  const baseHeights = useMemo(() => {
    const heights: number[] = [];
    const mid = Math.floor(barCount / 2);

    for (let i = 0; i < barCount; i++) {
      const distFromCenter = Math.abs(i - mid);
      // Create a smooth curve - taller in middle, shorter at edges
      const normalizedDist = distFromCenter / mid;
      const baseHeight = 2 + (6 - 2) * (1 - Math.pow(normalizedDist, 1.5));
      heights.push(baseHeight);
    }

    return heights;
  }, [barCount]);

  // Calculate reactive heights based on audio level
  const reactiveHeights = useMemo(() => {
    if (!isListening) {
      return baseHeights.map(() => 3); // Small dots when not listening
    }

    // Apply audio level with some variation for visual interest
    return baseHeights.map((baseHeight, index) => {
      // Add some randomness to make it feel more organic
      const variation = Math.sin(Date.now() / 200 + index) * 0.3 + 1;
      // Scale by audio level (with a minimum to keep it visible)
      const scaledHeight = baseHeight * (0.4 + audioLevel * 1.8) * variation;
      return Math.max(2, Math.min(12, scaledHeight));
    });
  }, [audioLevel, isListening, baseHeights]);

  return (
    <div className="frequency-bars-container">
      {reactiveHeights.map((height, index) => {
        const isBar = isListening;
        const isDot = !isListening;

        return (
          <motion.div
            key={`freq-${index}`}
            className={`frequency-element ${isDot ? 'as-dot' : 'as-bar'}`}
            animate={{
              height: isDot ? 2 : height,
              width: isDot ? 2 : 2,
              borderRadius: isDot ? '50%' : '1px',
              opacity: isDot ? (isHovered ? 0.8 : 0.6) : 0.7 + audioLevel * 0.3,
            }}
            transition={{
              height: {
                type: "spring",
                stiffness: isListening ? 400 : 300,
                damping: isListening ? 25 : 30,
                mass: 0.5,
              },
              width: { duration: 0.2 },
              borderRadius: { duration: 0.2 },
              opacity: { duration: 0.15 },
            }}
            style={{
              animationDelay: `${index * 0.04}s`,
            }}
          />
        );
      })}
    </div>
  );
};

export default FrequencyBars;
