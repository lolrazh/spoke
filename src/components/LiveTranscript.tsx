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
  visibleTextHeight,
  railOffsetY,
  overflowing,
  reducedMotion,
  onTextMetricsChange,
}: LiveTranscriptProps) {
  const intrinsicMeasureRef = useRef<HTMLSpanElement>(null);
  const wrappedMeasureRef = useRef<HTMLSpanElement>(null);
  const splitRef = useRef({
    fullText: "",
    stableText: "",
    appendedText: "",
  });
  if (splitRef.current.fullText !== text) {
    const previousText = splitRef.current.fullText;
    const appendedText = text.startsWith(previousText)
      ? text.slice(previousText.length)
      : "";
    splitRef.current = {
      fullText: text,
      stableText: appendedText
        ? text.slice(0, text.length - appendedText.length)
        : text,
      appendedText,
    };
  }
  const { stableText, appendedText } = splitRef.current;

  useLayoutEffect(() => {
    const intrinsicWidth = Math.ceil(
      intrinsicMeasureRef.current?.getBoundingClientRect().width ?? 0,
    );
    const wrappedMeasure = wrappedMeasureRef.current;
    if (!wrappedMeasure) return;

    const { textWidth } = calculateLiveTranscriptWidth({
      currentTextWidth: intrinsicWidth,
      baseWidth,
      maxWidth,
    });
    wrappedMeasure.style.width = `${textWidth}px`;
    onTextMetricsChange({
      textWidth: intrinsicWidth,
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
        style={{ height: visibleTextHeight }}
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
          <span>{stableText}</span>
          {appendedText ? (
            <m.span
              key={`${text.length}:${appendedText}`}
              initial={reducedMotion ? false : { opacity: 0, filter: "blur(2px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: reducedMotion ? 0 : 0.12, ease: "easeOut" }}
            >
              {appendedText}
            </m.span>
          ) : null}
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
