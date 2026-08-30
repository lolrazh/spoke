import React, { useEffect, useMemo, useRef } from "react";
import { m } from "framer-motion";
import { getAudioLevel, subscribeAudioLevel } from "../state/audioLevel";

const FREQUENCY_BAR_COUNT = 18;
const PROCESSING_FRAME_INTERVAL_MS = 33;

const BASE_FREQUENCY_HEIGHTS = Array.from(
  { length: FREQUENCY_BAR_COUNT },
  (_, index) => {
    const mid = Math.floor(FREQUENCY_BAR_COUNT / 2);
    const normalizedDist = Math.abs(index - mid) / mid;
    return 2 + (5.4 - 2) * (1 - Math.pow(normalizedDist, 1.5));
  },
);

interface FrequencyBarsProps {
  audioLevel: number;
  isListening: boolean;
  isHovered?: boolean;
}

/** Static/hover visualizer. Live and processing states use imperative leaves. */
const FrequencyBars: React.FC<FrequencyBarsProps> = ({
  audioLevel,
  isListening,
  isHovered = false,
}) => {
  const reactiveHeights = useMemo(() => {
    if (!isListening) {
      return BASE_FREQUENCY_HEIGHTS.map(() => 3);
    }

    const now = Date.now();
    return BASE_FREQUENCY_HEIGHTS.map((baseHeight, index) => {
      const variation = Math.sin(now / 100 + index) * 0.15 + 1;
      return Math.max(
        2,
        Math.min(12, baseHeight * (0.35 + audioLevel * 2.6) * variation),
      );
    });
  }, [audioLevel, isListening]);

  return (
    <div className="frequency-bars-container">
      {reactiveHeights.map((height, index) => {
        const isDot = !isListening;

        return (
          <m.div
            key={`freq-${index}`}
            className={`frequency-element ${isDot ? "as-dot" : "as-bar"}`}
            animate={{
              height: isDot ? 2 : height,
              width: 2,
              borderRadius: isDot ? "50%" : "1px",
              opacity: isDot ? (isHovered ? 0.8 : 0.6) : 1,
            }}
            transition={{
              height: {
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

/**
 * Recording visualizer. Audio frames update existing bar styles and schedule
 * at most one paint, so they do not re-render the pill or the app tree.
 */
export const ListeningFrequencyBars: React.FC = () => {
  const barsRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const scheduleUpdate = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        updateListeningBars(barsRef.current);
      });
    };

    const unsubscribe = subscribeAudioLevel(scheduleUpdate);
    updateListeningBars(barsRef.current);

    return () => {
      unsubscribe();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  return <StaticFrequencyBars barsRef={barsRef} />;
};

/** Processing visualizer. Its animation never enters React state. */
export const ProcessingFrequencyBars: React.FC = () => {
  const barsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let frameId: number | null = null;
    let lastUpdate = -Infinity;

    const animate = (timestamp: number) => {
      if (timestamp - lastUpdate >= PROCESSING_FRAME_INTERVAL_MS) {
        updateProcessingBars(barsRef.current, timestamp);
        lastUpdate = timestamp;
      }
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, []);

  return <StaticFrequencyBars barsRef={barsRef} />;
};

function StaticFrequencyBars({
  barsRef,
}: {
  barsRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={(node) => {
        barsRef.current = node;
      }}
      className="frequency-bars-container"
    >
      {Array.from({ length: FREQUENCY_BAR_COUNT }, (_, index) => (
        <div
          key={`freq-${index}`}
          className="frequency-element as-bar"
          style={{ height: "2px", width: "2px", borderRadius: "1px" }}
        />
      ))}
    </div>
  );
}

function updateListeningBars(container: HTMLDivElement | null): void {
  if (!container) return;

  const audioLevel = getAudioLevel();
  const now = Date.now();
  const elements = container.children;

  for (let index = 0; index < elements.length; index += 1) {
    const variation = Math.sin(now / 100 + index) * 0.15 + 1;
    const height = Math.max(
      2,
      Math.min(
        12,
        BASE_FREQUENCY_HEIGHTS[index] *
          (0.35 + audioLevel * 2.6) *
          variation,
      ),
    );
    (elements[index] as HTMLElement).style.height = `${height}px`;
  }
}

function updateProcessingBars(
  container: HTMLDivElement | null,
  timestamp: number,
): void {
  if (!container) return;

  const time = timestamp / 66;
  const elements = container.children;
  for (let index = 0; index < elements.length; index += 1) {
    const wave = Math.sin(time + index * 0.5) * 0.5 + 0.5;
    const slowVariation = Math.sin(timestamp / 198 + index * 0.4) * 0.12;
    const fastVariation = Math.sin(timestamp / 99 + index * 0.8) * 0.08;
    const microVariation = Math.sin(timestamp / 82.5 + index * 1.2) * 0.05;
    const totalVariation =
      1 + slowVariation + fastVariation + microVariation;
    const height = Math.max(
      2,
      Math.min(
        9,
        BASE_FREQUENCY_HEIGHTS[index] * (0.35 + wave * 1.8) * totalVariation,
      ),
    );
    (elements[index] as HTMLElement).style.height = `${height}px`;
  }
}
