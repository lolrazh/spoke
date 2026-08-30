import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import { m } from "framer-motion";

import {
  ListeningFrequencyBars,
  ProcessingFrequencyBars,
} from "./FrequencyBars";
import {
  getLiveTranscript,
  subscribeLiveTranscript,
} from "../state/liveTranscript";
import {
  boundLiveTranscriptText,
  splitLiveTranscriptText,
  type LiveTranscriptText,
} from "./liveTranscriptText";

export const LIVE_TRANSCRIPT_CARET_IDLE_MS = 480;

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

type LiveTranscriptVisualProps = Omit<LiveTranscriptProps, "text">;

type LiveTranscriptRefs = {
  committed: RefObject<HTMLSpanElement>;
  tentative: RefObject<HTMLSpanElement>;
  caret: RefObject<HTMLSpanElement>;
  measure: RefObject<HTMLSpanElement>;
};

/**
 * Store-connected leaf. Partial hypotheses update existing text nodes directly
 * so even the live transcript leaf does not enter React's render path.
 */
export function LiveTranscriptFromStore(
  props: LiveTranscriptVisualProps,
) {
  const committedRef = useRef<HTMLSpanElement>(null);
  const tentativeRef = useRef<HTMLSpanElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const wrappedMeasureRef = useRef<HTMLSpanElement>(null);
  const latestPropsRef = useRef(props);
  const caretTimerRef = useRef<number | null>(null);
  const caretLastUpdatedAtRef = useRef<number | null>(null);
  const fallbackMeasureFrameRef = useRef<number | null>(null);
  const lastMeasuredHeightRef = useRef<number | null>(null);
  const committedTextRef = useRef<string | null>(null);
  const tentativeTextRef = useRef<string | null>(null);
  const measuredTextRef = useRef<string | null>(null);
  latestPropsRef.current = props;

  const publishMeasuredHeight = useCallback((height: number) => {
    const roundedHeight = Math.ceil(Math.max(height, 0));
    if (lastMeasuredHeightRef.current === roundedHeight) return;
    lastMeasuredHeightRef.current = roundedHeight;
    latestPropsRef.current.onTextMetricsChange({
      wrappedTextHeight: roundedHeight,
    });
  }, []);

  const armCaretTimer = useCallback(() => {
    if (caretTimerRef.current !== null) return;

    const lastUpdatedAt = caretLastUpdatedAtRef.current;
    const remainingMs =
      lastUpdatedAt === null
        ? LIVE_TRANSCRIPT_CARET_IDLE_MS
        : Math.max(
            0,
            LIVE_TRANSCRIPT_CARET_IDLE_MS - (Date.now() - lastUpdatedAt),
          );

    caretTimerRef.current = window.setTimeout(() => {
      caretTimerRef.current = null;
      const caret = caretRef.current;
      const latestUpdate = caretLastUpdatedAtRef.current;
      if (!caret || latestUpdate === null) return;

      const remaining =
        LIVE_TRANSCRIPT_CARET_IDLE_MS - (Date.now() - latestUpdate);
      if (remaining > 0) {
        armCaretTimer();
        return;
      }
      caret.classList.add("is-blinking");
    }, remainingMs);
  }, []);

  const updateText = useCallback((text: string) => {
    const { isProcessing, reducedMotion } = latestPropsRef.current;
    const boundedText = boundLiveTranscriptText(text);
    const displayText = splitLiveTranscriptText(boundedText, isProcessing);

    if (
      committedRef.current &&
      committedTextRef.current !== displayText.committed
    ) {
      committedRef.current.textContent = displayText.committed;
      committedTextRef.current = displayText.committed;
    }
    if (
      tentativeRef.current &&
      tentativeTextRef.current !== displayText.tentative
    ) {
      tentativeRef.current.textContent = displayText.tentative;
      tentativeTextRef.current = displayText.tentative;
    }
    if (
      wrappedMeasureRef.current &&
      measuredTextRef.current !== boundedText
    ) {
      wrappedMeasureRef.current.textContent = boundedText;
      measuredTextRef.current = boundedText;
    }

    const shouldBlink = !isProcessing && !reducedMotion;
    if (!shouldBlink) {
      caretLastUpdatedAtRef.current = null;
      if (caretTimerRef.current !== null) {
        window.clearTimeout(caretTimerRef.current);
        caretTimerRef.current = null;
      }
    }
    const caret = caretRef.current;
    if (caret) {
      caret.classList.remove("is-blinking");
      if (shouldBlink) {
        caretLastUpdatedAtRef.current = Date.now();
        armCaretTimer();
      }
    }

    if (!window.ResizeObserver && fallbackMeasureFrameRef.current === null) {
      fallbackMeasureFrameRef.current = window.requestAnimationFrame(() => {
        fallbackMeasureFrameRef.current = null;
        const measure = wrappedMeasureRef.current;
        if (measure) publishMeasuredHeight(measure.getBoundingClientRect().height);
      });
    }
  }, [armCaretTimer, publishMeasuredHeight]);

  useLayoutEffect(() => {
    updateText(getLiveTranscript());
    const unsubscribe = subscribeLiveTranscript(() => {
      updateText(getLiveTranscript());
    });

    return () => {
      unsubscribe();
      if (caretTimerRef.current !== null) {
        window.clearTimeout(caretTimerRef.current);
        caretTimerRef.current = null;
      }
      caretLastUpdatedAtRef.current = null;
      if (fallbackMeasureFrameRef.current !== null) {
        window.cancelAnimationFrame(fallbackMeasureFrameRef.current);
        fallbackMeasureFrameRef.current = null;
      }
    };
  }, [updateText]);

  useEffect(() => {
    updateText(getLiveTranscript());
  }, [props.isProcessing, props.reducedMotion, updateText]);

  useEffect(() => {
    const wrappedMeasure = wrappedMeasureRef.current;
    const ResizeObserverCtor = window.ResizeObserver;
    if (!wrappedMeasure || !ResizeObserverCtor) return;

    const observer = new ResizeObserverCtor(([entry]) => {
      publishMeasuredHeight(entry?.contentRect.height ?? 0);
    });
    observer.observe(wrappedMeasure);
    return () => observer.disconnect();
  }, [publishMeasuredHeight, props.textWidth]);

  return (
    <LiveTranscriptMarkup
      {...props}
      text=""
      displayText={{ committed: "", tentative: "" }}
      caretIdle={false}
      imperativeText
      refs={{
        committed: committedRef,
        tentative: tentativeRef,
        caret: caretRef,
        measure: wrappedMeasureRef,
      }}
    />
  );
}

function LiveTranscriptMarkup({
  text,
  isProcessing,
  textWidth,
  visibleTextHeight,
  railOffsetY,
  overflowing,
  reducedMotion,
  displayText,
  caretIdle,
  refs,
  imperativeText = false,
}: LiveTranscriptProps & {
  displayText: LiveTranscriptText;
  caretIdle: boolean;
  refs: LiveTranscriptRefs;
  imperativeText?: boolean;
}) {
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
          <span ref={refs.committed} className="live-transcript-committed">
            {imperativeText ? null : displayText.committed}
          </span>
          <m.span
            key={imperativeText ? undefined : displayText.committed}
            ref={refs.tentative}
            className="live-transcript-tentative"
            initial={reducedMotion ? false : { opacity: 0.72 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: reducedMotion ? 0 : 0.1,
              ease: "easeOut",
            }}
          >
            {imperativeText ? null : displayText.tentative}
          </m.span>
          {!isProcessing && (
            <span
              ref={refs.caret}
              className={`live-transcript-caret ${caretIdle ? "is-blinking" : ""}`}
            />
          )}
        </m.span>
      </div>

      <span
        ref={refs.measure}
        className="live-transcript-measure live-transcript-measure-wrapped"
        style={{ width: textWidth }}
      >
        {imperativeText ? null : text}
      </span>
    </m.div>
  );
}
