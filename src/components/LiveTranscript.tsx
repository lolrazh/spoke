import { useLayoutEffect, useRef } from "react";
import { m } from "framer-motion";

import { MOTION } from "../config/motionTokens";
import FrequencyBars, { ListeningFrequencyBars } from "./FrequencyBars";
import { calculateLiveTranscriptWidth } from "./liveTranscriptLayout";

export type LiveTranscriptMetrics = {
  textWidth: number;
  wrappedTextHeight: number;
};

type LiveTranscriptProps = {
  text: string;
  isProcessing: boolean;
  baseWidth: number;
  maxWidth: number;
  textWidth: number;
  visibleTextHeight: number;
  railOffsetY: number;
  overflowing: boolean;
  reducedMotion: boolean;
  onTextMetricsChange: (metrics: LiveTranscriptMetrics) => void;
};

/** Visual-only partial transcript. Final publication remains in useTranscription. */
export function LiveTranscript({
  text,
  isProcessing,
  baseWidth,
  maxWidth,
  textWidth,
  visibleTextHeight,
  railOffsetY,
  overflowing,
  reducedMotion,
  onTextMetricsChange,
}: LiveTranscriptProps) {
  const intrinsicMeasureRef = useRef<HTMLSpanElement>(null);
  const wrappedMeasureRef = useRef<HTMLSpanElement>(null);
  const maxIntrinsicWidthRef = useRef(0);

  useLayoutEffect(() => {
    const intrinsicWidth = Math.ceil(
      intrinsicMeasureRef.current?.getBoundingClientRect().width ?? 0,
    );
    const wrappedMeasure = wrappedMeasureRef.current;
    if (!wrappedMeasure) return;

    // Streaming ASR can revise an earlier partial. Keep the layout extent from
    // contracting when that happens; it resets when this component unmounts.
    maxIntrinsicWidthRef.current = Math.max(
      maxIntrinsicWidthRef.current,
      intrinsicWidth,
    );
    const { textWidth } = calculateLiveTranscriptWidth({
      currentTextWidth: maxIntrinsicWidthRef.current,
      baseWidth,
      maxWidth,
    });
    wrappedMeasure.style.width = `${textWidth}px`;
    onTextMetricsChange({
      textWidth: maxIntrinsicWidthRef.current,
      wrappedTextHeight: Math.ceil(
        wrappedMeasure.getBoundingClientRect().height,
      ),
    });
  }, [baseWidth, maxWidth, onTextMetricsChange, text]);

  return (
    <div className="live-transcript" aria-hidden="true">
      <div className="live-transcript-activity">
        {isProcessing ? (
          <FrequencyBars
            audioLevel={0}
            isListening={false}
            isIdle={false}
            isHovered={false}
            isProcessing={true}
          />
        ) : (
          <ListeningFrequencyBars
            isListening={true}
            isIdle={false}
            isHovered={false}
            isProcessing={false}
          />
        )}
      </div>

      <div
        className={`live-transcript-viewport ${overflowing ? "is-overflowing" : ""}`}
        style={{ width: textWidth, height: visibleTextHeight }}
      >
        <m.span
          className="live-transcript-rail"
          animate={{ y: railOffsetY }}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { type: "spring", ...MOTION.springs.transcript }
          }
        >
          {text}
        </m.span>
      </div>

      <span
        ref={intrinsicMeasureRef}
        className="live-transcript-measure live-transcript-measure-intrinsic"
      >
        {text}
      </span>
      <span
        ref={wrappedMeasureRef}
        className="live-transcript-measure live-transcript-measure-wrapped"
      >
        {text}
      </span>
    </div>
  );
}
