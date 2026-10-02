import React, { useLayoutEffect, useRef } from "react";
import { getAudioLevel, subscribeAudioLevel } from "../state/audioLevel";
import { ListeningMeter } from "./listeningMeter";
import { processingBounceFrame } from "./processingBounce";

const FREQUENCY_BAR_COUNT = 18;
const METER_SAMPLE_COUNT = 8;
const MAX_FREQUENCY_HEIGHT = 12;

const MODE_MORPH_MS = 120;

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

/** Keep the same leaves and morph from their displayed values on a mode change. */
export const FrequencyBars: React.FC<{ mode: "listening" | "processing" }> = React.memo(({ mode }) => {
  const barsRef = useRef<HTMLDivElement | null>(null);
  const presented = useRef({
    heights: new Float32Array(FREQUENCY_BAR_COUNT).fill(2),
    opacities: new Float32Array(FREQUENCY_BAR_COUNT).fill(1),
  });
  const previousMode = useRef<typeof mode | null>(null);

  useLayoutEffect(() => {
    const started = performance.now();
    const morph = previousMode.current !== null && previousMode.current !== mode;
    previousMode.current = mode;
    const origins = {
      heights: presented.current.heights.slice(),
      opacities: presented.current.opacities.slice(),
    };
    const meter = mode === "listening" ? new ListeningMeter(METER_SAMPLE_COUNT, started) : null;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame: number | null = null;
    const observe = () => meter?.observe(getAudioLevel(), performance.now());
    const draw = (now: number) => {
      const bars = barsRef.current?.children;
      if (!bars) return;
      const source = meter?.advance(now, preference.matches);
      const progress = !morph || preference.matches ? 1 :
        Math.min(1, Math.max(0, (now - started) / MODE_MORPH_MS));
      const blend = progress * progress * (3 - 2 * progress);
      for (let index = 0; index < bars.length; index++) {
        let height: number;
        let opacity: number;
        if (source) {
          // Only interpolate in space; the eight samples already have easing.
          const position = index / (FREQUENCY_BAR_COUNT - 1) * (METER_SAMPLE_COUNT - 1);
          const lower = Math.floor(position);
          const upper = Math.min(METER_SAMPLE_COUNT - 1, lower + 1);
          const fraction = position - lower;
          height = Math.min(MAX_FREQUENCY_HEIGHT,
            source[lower] * (1 - fraction) + source[upper] * fraction);
          opacity = 1;
        } else {
          ({ height, opacity } = processingBounceFrame(
            (now - started) / 1000, index, FREQUENCY_BAR_COUNT, preference.matches,
          ));
        }
        // This blend runs only during a mode handoff, never on ongoing speech.
        height = origins.heights[index] + (height - origins.heights[index]) * blend;
        opacity = origins.opacities[index] + (opacity - origins.opacities[index]) * blend;
        const bar = bars[index] as HTMLElement;
        if (Math.abs(height - presented.current.heights[index]) >= 0.006) {
          bar.style.transform = `scaleY(${height / MAX_FREQUENCY_HEIGHT})`;
          presented.current.heights[index] = height;
        }
        if (Math.abs(opacity - presented.current.opacities[index]) >= 0.0005) {
          bar.style.opacity = String(opacity);
          presented.current.opacities[index] = opacity;
        }
      }
    };
    const tick = (now: number) => {
      frame = null;
      draw(now);
      if (meter || !preference.matches) frame = requestAnimationFrame(tick);
    };
    const refreshPreference = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      tick(performance.now());
    };
    const unsubscribe = meter ? subscribeAudioLevel(observe) : undefined;
    observe();
    tick(started);
    preference.addEventListener("change", refreshPreference);
    return () => {
      unsubscribe?.();
      preference.removeEventListener("change", refreshPreference);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [mode]);

  return (
    <div ref={barsRef} className="frequency-bars-container" aria-hidden="true">
      {Array.from({ length: FREQUENCY_BAR_COUNT }, (_, index) => (
        <div
          key={`freq-${index}`}
          className="frequency-element as-bar"
          style={{
            height: `${MAX_FREQUENCY_HEIGHT}px`,
            width: "2px",
            borderRadius: "1px",
            transform: `scaleY(${2 / MAX_FREQUENCY_HEIGHT})`,
            transformOrigin: "center",
          }}
        />
      ))}
    </div>
  );
});
