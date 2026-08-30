import React, { useEffect, useRef } from "react";
import { getAudioLevel, subscribeAudioLevel } from "../state/audioLevel";

const FREQUENCY_BAR_COUNT = 18;
const MAX_FREQUENCY_HEIGHT = 12;

const BASE_FREQUENCY_HEIGHTS = Array.from(
  { length: FREQUENCY_BAR_COUNT },
  (_, index) => {
    const mid = Math.floor(FREQUENCY_BAR_COUNT / 2);
    const normalizedDist = Math.abs(index - mid) / mid;
    return 2 + (5.4 - 2) * (1 - Math.pow(normalizedDist, 1.5));
  },
);

/** Fixed hover-preview dots. Recording and processing use imperative leaves. */
export const HoverFrequencyBars: React.FC = React.memo(() => (
  <div className="frequency-bars-container">
    {Array.from({ length: FREQUENCY_BAR_COUNT }, (_, index) => (
      <div
        key={`freq-${index}`}
        className="frequency-element as-dot"
        style={{
          height: "2px",
          width: "2px",
          borderRadius: "50%",
          opacity: 0.8,
        }}
      />
    ))}
  </div>
));

/**
 * Recording visualizer. Audio frames update existing bar styles and schedule
 * at most one paint, so they do not re-render the pill or the app tree.
 */
export const ListeningFrequencyBars: React.FC = React.memo(() => {
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
});

/** Processing visualizer. CSS owns the animation; no renderer timer is needed. */
export const ProcessingFrequencyBars: React.FC = React.memo(() => (
  <StaticFrequencyBars barClassName="processing-frequency-element" />
));

function StaticFrequencyBars({
  barsRef,
  barClassName = "",
}: {
  barsRef?: React.MutableRefObject<HTMLDivElement | null>;
  barClassName?: string;
}) {
  return (
    <div
      ref={
        barsRef
          ? (node) => {
              barsRef.current = node;
            }
          : undefined
      }
      className="frequency-bars-container"
    >
      {Array.from({ length: FREQUENCY_BAR_COUNT }, (_, index) => (
        <div
          key={`freq-${index}`}
          className={`frequency-element as-bar ${barClassName}`}
          style={{
            height: `${MAX_FREQUENCY_HEIGHT}px`,
            width: "2px",
            borderRadius: "1px",
            transform: "scaleY(0.1666666667)",
            transformOrigin: "center",
            ...(barClassName
              ? ({
                  animationDelay: `${-index * 0.06}s`,
                  "--processing-min-scale": String(
                    Math.max(2, BASE_FREQUENCY_HEIGHTS[index] * 0.35) /
                      MAX_FREQUENCY_HEIGHT,
                  ),
                  "--processing-max-scale": String(
                    Math.min(9, BASE_FREQUENCY_HEIGHTS[index] * 2.15) /
                      MAX_FREQUENCY_HEIGHT,
                  ),
                } as React.CSSProperties)
              : {}),
          }}
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
    (elements[index] as HTMLElement).style.transform = `scaleY(${height / MAX_FREQUENCY_HEIGHT})`;
  }
}
