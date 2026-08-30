import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "framer-motion";

import {
  ListeningFrequencyBars,
  ProcessingFrequencyBars,
} from "./FrequencyBars";
import { splitLiveTranscriptText } from "./liveTranscriptText";
import { useLiveTranscript } from "../state/liveTranscript";

export const LIVE_TRANSCRIPT_CARET_IDLE_MS = 480;

export type LiveTranscriptMetrics = {
  wrappedTextHeight: number;
};

export type LiveTranscriptProps = {
  text: string;
  isProcessing: boolean;
  textWidth: number;
  visibleTextHeight: number;
  railOffsetY: number;
  overflowing: boolean;
  reducedMotion: boolean;
  onTextMetricsChange: (metrics: LiveTranscriptMetrics) => void;
};

/** Store-connected leaf so live partials do not re-render the pill shell. */
export function LiveTranscriptFromStore(
  props: Omit<LiveTranscriptProps, "text">,
) {
  const text = useLiveTranscript();
  return <LiveTranscript {...props} text={text} />;
}

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
  const lastMeasuredHeightRef = useRef<number | null>(null);
  const [caretIdle, setCaretIdle] = useState(false);
  const displayText = splitLiveTranscriptText(text, isProcessing);

  useEffect(() => {
    setCaretIdle(false);
    if (isProcessing || reducedMotion) return;

    const timeoutId = window.setTimeout(
      () => setCaretIdle(true),
      LIVE_TRANSCRIPT_CARET_IDLE_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [isProcessing, reducedMotion, text]);

  const publishMeasuredHeight = useCallback(
    (height: number) => {
      const roundedHeight = Math.ceil(Math.max(height, 0));
      if (lastMeasuredHeightRef.current === roundedHeight) return;
      lastMeasuredHeightRef.current = roundedHeight;
      onTextMetricsChange({ wrappedTextHeight: roundedHeight });
    },
    [onTextMetricsChange],
  );

  // The hidden span changes size as partial text arrives. ResizeObserver lets
  // the browser report that change after layout instead of forcing a sync
  // getBoundingClientRect() read for every partial transcript.
  useEffect(() => {
    const wrappedMeasure = wrappedMeasureRef.current;
    const ResizeObserverCtor = window.ResizeObserver;
    if (!wrappedMeasure || !ResizeObserverCtor) return;

    const observer = new ResizeObserverCtor(([entry]) => {
      publishMeasuredHeight(entry?.contentRect.height ?? 0);
    });
    observer.observe(wrappedMeasure);

    return () => observer.disconnect();
  }, [publishMeasuredHeight, textWidth]);

  // Older Electron/test environments may not expose ResizeObserver. Keep a
  // one-frame fallback for those environments without blocking the commit.
  useEffect(() => {
    if (window.ResizeObserver) return;
    const frameId = window.requestAnimationFrame(() => {
      const wrappedMeasure = wrappedMeasureRef.current;
      if (!wrappedMeasure) return;
      publishMeasuredHeight(wrappedMeasure.getBoundingClientRect().height);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [publishMeasuredHeight, text, textWidth]);

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
          <ProcessingFrequencyBars />
        ) : (
          <ListeningFrequencyBars />
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
          {!isProcessing && (
            <span
              className={`live-transcript-caret ${caretIdle ? "is-blinking" : ""}`}
            />
          )}
        </m.span>
      </div>

      <span
        ref={wrappedMeasureRef}
        className="live-transcript-measure live-transcript-measure-wrapped"
        style={{ width: textWidth }}
      >
        {text}
      </span>
    </m.div>
  );
}
