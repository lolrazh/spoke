import { useLayoutEffect, useRef } from "react";
import { m } from "framer-motion";

import FrequencyBars, { ListeningFrequencyBars } from "./FrequencyBars";
import { splitLiveTranscriptText } from "./liveTranscriptText";

export type LiveTranscriptMetrics = {
  wrappedTextHeight: number;
};

type LiveTranscriptProps = {
  text: string;
  isProcessing: boolean;
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
  textWidth,
  visibleTextHeight,
  railOffsetY,
  overflowing,
  reducedMotion,
  onTextMetricsChange,
}: LiveTranscriptProps) {
  const wrappedMeasureRef = useRef<HTMLSpanElement>(null);
  const displayText = splitLiveTranscriptText(text, isProcessing);

  useLayoutEffect(() => {
    const wrappedMeasure = wrappedMeasureRef.current;
    if (!wrappedMeasure) return;

    wrappedMeasure.style.width = `${textWidth}px`;
    onTextMetricsChange({
      wrappedTextHeight: Math.ceil(
        wrappedMeasure.getBoundingClientRect().height,
      ),
    });
  }, [onTextMetricsChange, text, textWidth]);

  return (
    <m.div
      className="live-transcript"
      aria-hidden="true"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        duration: reducedMotion ? 0 : 0.16,
        delay: reducedMotion ? 0 : 0.06,
        ease: "easeOut",
      }}
    >
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
        style={{ height: visibleTextHeight }}
      >
        <m.span
          className="live-transcript-rail"
          animate={{ y: railOffsetY }}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { duration: 0.14, ease: [0.2, 0, 0, 1] }
          }
        >
          <span className="live-transcript-committed">
            {displayText.committed}
          </span>
          <m.span
            key={displayText.committed}
            className="live-transcript-tentative"
            initial={reducedMotion ? false : { opacity: 0.72 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: reducedMotion ? 0 : 0.1,
              ease: "easeOut",
            }}
          >
            {displayText.tentative}
          </m.span>
        </m.span>
      </div>

      <span
        ref={wrappedMeasureRef}
        className="live-transcript-measure live-transcript-measure-wrapped"
      >
        {text}
      </span>
    </m.div>
  );
}
