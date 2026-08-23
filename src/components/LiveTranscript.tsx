import { useLayoutEffect, useRef } from "react";
import { m } from "framer-motion";

import { MOTION } from "../config/motionTokens";
import FrequencyBars, { ListeningFrequencyBars } from "./FrequencyBars";

type LiveTranscriptProps = {
  text: string;
  isProcessing: boolean;
  railOffsetX: number;
  overflowing: boolean;
  reducedMotion: boolean;
  onTextWidthChange: (width: number) => void;
};

/** Visual-only partial transcript. Final publication remains in useTranscription. */
export function LiveTranscript({
  text,
  isProcessing,
  railOffsetX,
  overflowing,
  reducedMotion,
  onTextWidthChange,
}: LiveTranscriptProps) {
  const measureRef = useRef<HTMLSpanElement>(null);
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
    const width = measureRef.current?.getBoundingClientRect().width ?? 0;
    onTextWidthChange(Math.ceil(width));
  }, [onTextWidthChange, text]);

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
      >
        <m.span
          className="live-transcript-rail"
          animate={{ x: railOffsetX }}
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

      <span ref={measureRef} className="live-transcript-measure">
        {text}
      </span>
    </div>
  );
}
