import React, { useMemo } from "react";
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
  isHovered = false,
  isProcessing = false,
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

    const now = Date.now();

    return baseHeights.map((baseHeight, index) => {
      if (isProcessing) {
        return Math.max(2, Math.min(9, baseHeight * 1.1));
      }

      const listeningVariation = Math.sin(now / 100 + index) * 0.15 + 1;
      const listeningScaled =
        baseHeight * (0.35 + audioLevel * 2.6) * listeningVariation;
      return Math.max(2, Math.min(12, listeningScaled));
    });
  }, [audioLevel, isListening, isProcessing, baseHeights]);

  return (
    <div className="frequency-bars-container">
      {reactiveHeights.map((height, index) => {
        const isDot = !isListening && !isProcessing;
        const processingHeights = buildProcessingKeyframes(height, index);

        return (
          <motion.div
            key={`freq-${index}`}
            className={`frequency-element ${isDot ? "as-dot" : "as-bar"}`}
            animate={{
              height: isProcessing
                ? processingHeights
                : isDot
                  ? 2
                  : height,
              width: isDot ? 2 : 2,
              borderRadius: isDot ? "50%" : "1px",
              opacity: isDot ? (isHovered ? 0.8 : 0.6) : 1.0,
            }}
            transition={{
              height: isProcessing
                ? {
                    duration: 1.05,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                    delay: index * 0.025,
                  }
                : {
                    type: "spring",
                    stiffness: isListening ? 750 : 350,
                    damping: isListening ? 19 : 28,
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

function buildProcessingKeyframes(height: number, index: number): number[] {
  const phase = index * 0.45;
  const low = Math.max(2, height * (0.55 + Math.sin(phase) * 0.08));
  const mid = Math.max(2, height * (1.25 + Math.cos(phase) * 0.12));
  const high = Math.max(2, height * (1.65 + Math.sin(phase + 1.1) * 0.12));
  return [low, mid, high, mid, low];
}
