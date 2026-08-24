import { useEffect, useRef, useState } from "react";

const DEFAULT_DRAIN_MS = 220;
const DEFAULT_MAX_GRAPHEME_INTERVAL_MS = 16;
const DEFAULT_MAX_GRAPHEMES_PER_FRAME = 4;

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

const splitGraphemes = (text: string): string[] =>
  Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);

type SmoothTranscriptOptions = {
  enabled: boolean;
  drainMs?: number;
  maxGraphemeIntervalMs?: number;
  maxGraphemesPerFrame?: number;
};

type AnimationState = {
  displayed: string[];
  target: string[];
  frameId: number | null;
  lastFrameTime: number | null;
};

/**
 * Pace cumulative ASR partials across display frames.
 *
 * Raw text remains authoritative for layout and final publication. This hook
 * only controls the visual projection. When ASR revises an earlier word, the
 * visible prefix is corrected in place and only its unseen suffix is paced.
 */
export function useSmoothTranscriptText(
  targetText: string,
  {
    enabled,
    drainMs = DEFAULT_DRAIN_MS,
    maxGraphemeIntervalMs = DEFAULT_MAX_GRAPHEME_INTERVAL_MS,
    maxGraphemesPerFrame = DEFAULT_MAX_GRAPHEMES_PER_FRAME,
  }: SmoothTranscriptOptions,
): string {
  const [displayedText, setDisplayedText] = useState(
    enabled ? "" : targetText,
  );
  const animationRef = useRef<AnimationState>({
    displayed: enabled ? [] : splitGraphemes(targetText),
    target: splitGraphemes(targetText),
    frameId: null,
    lastFrameTime: null,
  });
  const animateRef = useRef<(time: number) => void>(() => undefined);

  animateRef.current = (time: number) => {
    const animation = animationRef.current;
    const remaining = animation.target.length - animation.displayed.length;
    if (remaining <= 0) {
      animation.frameId = null;
      animation.lastFrameTime = null;
      return;
    }

    const elapsed =
      animation.lastFrameTime === null
        ? 1000 / 60
        : Math.max(0, time - animation.lastFrameTime);
    const interval = Math.max(
      1,
      Math.min(maxGraphemeIntervalMs, drainMs / remaining),
    );
    const count = Math.min(
      remaining,
      maxGraphemesPerFrame,
      Math.floor(elapsed / interval),
    );

    animation.lastFrameTime = time;
    if (count > 0) {
      animation.displayed = animation.target.slice(
        0,
        animation.displayed.length + count,
      );
      setDisplayedText(animation.displayed.join(""));
    }

    if (animation.displayed.length < animation.target.length) {
      animation.frameId = requestAnimationFrame(animateRef.current);
    } else {
      animation.frameId = null;
      animation.lastFrameTime = null;
    }
  };

  useEffect(() => {
    const animation = animationRef.current;
    const target = splitGraphemes(targetText);

    if (!enabled) {
      if (animation.frameId !== null) {
        cancelAnimationFrame(animation.frameId);
      }
      animation.displayed = target;
      animation.target = target;
      animation.frameId = null;
      animation.lastFrameTime = null;
      setDisplayedText(targetText);
      return;
    }

    // Keep the current visible length during a correction. This replaces an
    // unstable word without erasing and retyping the whole partial.
    const retainedLength = Math.min(animation.displayed.length, target.length);
    const correctedPrefix = target.slice(0, retainedLength);
    if (correctedPrefix.join("") !== animation.displayed.join("")) {
      animation.displayed = correctedPrefix;
      setDisplayedText(correctedPrefix.join(""));
    }
    animation.target = target;

    if (
      animation.displayed.length < animation.target.length &&
      animation.frameId === null
    ) {
      animation.lastFrameTime = null;
      animation.frameId = requestAnimationFrame(animateRef.current);
    }
  }, [enabled, targetText]);

  useEffect(
    () => () => {
      const animation = animationRef.current;
      if (animation.frameId !== null) {
        cancelAnimationFrame(animation.frameId);
      }
      animation.frameId = null;
      animation.lastFrameTime = null;
    },
    [],
  );

  return displayedText;
}
