import React, { useState, useLayoutEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PILL_ANIMATION_DURATION } from "../constants/animations";
import { TOKENS } from "../config/uiTokens";
import { useGhostMeasure } from "../hooks/useGhostMeasure";

// Update the type for our new "notification play" prop
type NotificationPlay = {
  text: string;
  phase: "shrinking" | "showing";
} | null;

// Re-using the type from App.tsx to ensure consistency
type PillMetrics = {
  pillRect: DOMRect | null;
  notificationText: string | null;
  devicePixelRatio: number;
};

interface PillProps {
  isListening: boolean;
  isProcessing: boolean;
  isHovered: boolean;
  notificationPlay: NotificationPlay;
  onStartDictation: () => void;
  onStopDictation: () => void;
  onHoverChange: (hovered: boolean) => void;
  onMetrics: (metrics: PillMetrics) => void;
}

// Helper function to read CSS variables from the DOM, with a fallback
const getCssVar = (name: string, fallback: number): number => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  const parsedValue = parseInt(value, 10);
  return isNaN(parsedValue) ? fallback : parsedValue;
};

const Pill: React.FC<PillProps> = ({
  isListening,
  isProcessing,
  isHovered,
  notificationPlay,
  onStartDictation,
  onStopDictation,
  onHoverChange,
  onMetrics,
}) => {
  // --- Refs ---
  const pillCoreRef = useRef<HTMLDivElement>(null);
  const lastSentWidthRef = useRef<number | null>(null);

  // --- Ghost Measurement ---
  const ghostWidth = useGhostMeasure(notificationPlay?.text ?? "");

  // --- Read constants from CSS with fallbacks from tokens ---
  const PILL_EXPANDED_WIDTH = useMemo(
    () => getCssVar("--pill-expanded-width", TOKENS.PILL_BASE_W),
    [],
  );
  const PILL_EXPANDED_HEIGHT = useMemo(
    () => getCssVar("--pill-expanded-height", TOKENS.PILL_BASE_H),
    [],
  );
  const PILL_RESTING_HEIGHT = useMemo(
    () => getCssVar("--pill-resting-height", TOKENS.PILL_RESTING_H),
    [],
  );

  // --- State ---
  const [pillWidth, setPillWidth] = useState(PILL_EXPANDED_WIDTH); // Default width

  // --- Height Calculation ---
  const pillHeight = useMemo(() => {
    if (notificationPlay?.phase === "shrinking") {
      return PILL_RESTING_HEIGHT;
    }
    const isExpanded =
      isListening || isProcessing || isHovered || !!notificationPlay;
    return isExpanded ? PILL_EXPANDED_HEIGHT : PILL_RESTING_HEIGHT;
  }, [
    notificationPlay,
    isListening,
    isProcessing,
    isHovered,
    PILL_EXPANDED_HEIGHT,
    PILL_RESTING_HEIGHT,
  ]);

  // --- Constants ---
  const VISUALIZATION_COUNT = 7;

  // --- Animation Variants ---
  const transition = {
    duration: PILL_ANIMATION_DURATION / 1000, // Convert ms to seconds for Framer Motion
    ease: "easeInOut" as const,
  };

  // --- Core Sizing and Resize Logic ---
  useLayoutEffect(() => {
    const targetWidth = (() => {
      if (!notificationPlay) {
        return PILL_EXPANDED_WIDTH;
      }
      // When shrinking, we want the base width, not the measured width.
      if (notificationPlay.phase === "shrinking") {
        return PILL_EXPANDED_WIDTH;
      }
      // Otherwise, calculate the width based on the ghost measurement.
      const rawWidth = ghostWidth + TOKENS.NOTIF_PAD_X;
      // Allow shrinking, but clamp to a new minimum width to prevent collapse.
      const MIN_PILL_W = 100;
      return Math.max(MIN_PILL_W, Math.min(rawWidth, TOKENS.PILL_MAX_W));
    })();

    setPillWidth(targetWidth);

    // Only send resize command if the width has meaningfully changed.
    if (lastSentWidthRef.current !== targetWidth) {
      window.electron.resizePill(targetWidth, pillHeight);
      lastSentWidthRef.current = targetWidth;
    }
  }, [ghostWidth, notificationPlay, PILL_EXPANDED_WIDTH, pillHeight]);

  // --- Metrics Reporting ---
  useLayoutEffect(() => {
    if (!onMetrics) return;

    const pillRect = pillCoreRef.current?.getBoundingClientRect() ?? null;

    onMetrics({
      pillRect,
      notificationText: notificationPlay?.text ?? null,
      devicePixelRatio: window.devicePixelRatio,
    });
  }, [
    pillWidth,
    notificationPlay,
    onMetrics,
    pillHeight,
    // Note: pillHeight is derived and will trigger a re-render anyway
  ]);

  const isShowingNotification = notificationPlay?.phase === "showing";
  const isResting = pillHeight === PILL_RESTING_HEIGHT;

  // Generate frequency bars for the waveform (active state)
  const renderFrequencyBars = useMemo(
    () =>
      // Create bars with consistent count
      Array.from({ length: VISUALIZATION_COUNT }).map((_, index) => (
        <div
          key={`bar-${index}`}
          className="waveform-bar"
          style={{
            animationDelay: `${index * 0.1}s`,
            height: `${3 + Math.random() * 5}px`,
          }}
        />
      )),
    [], // Empty dependency array means this runs only once
  );

  // Unified function to render dots with different styles
  const renderDots = (type: "static" | "animated" | "collapsed") => {
    return Array.from({ length: VISUALIZATION_COUNT }).map((_, index) => (
      <div
        key={`dot-${type}-${index}`}
        className={`dot ${type}`}
        style={
          type === "animated"
            ? { animationDelay: `${index * 0.12}s` }
            : undefined
        }
      />
    ));
  };

  // Handle context menu for pill
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Use the exposed context menu API
    if (window.contextMenu?.showPill) {
      window.contextMenu.showPill();
    } else {
      console.warn("[Pill] window.contextMenu.showPill not available");
    }
  };

  return (
    <div
      className={`
        pill-wrapper transition-all duration-300 ease-out
        ${isResting ? "resting-state" : ""}
      `}
      onClick={isListening ? onStopDictation : onStartDictation}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <motion.div
        ref={pillCoreRef}
        className="pill-core"
        initial={false}
        animate={{ width: pillWidth, height: pillHeight }}
        transition={transition}
      >
        <div className="pill-content flex items-center justify-center w-full h-full">
          <AnimatePresence mode="wait">
            {isShowingNotification ? (
              <motion.span
                key="notification"
                // The textRef is no longer needed for measurement.
                // We keep it on the span in case we need it for other things later.
                className="notification-text"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {notificationPlay.text}
              </motion.span>
            ) : (
              <motion.div
                key="visualizer"
                className="visualization-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {/* Visuals for non-notification states */}
                {!isResting && isListening && <>{renderFrequencyBars}</>}
                {!isResting && isProcessing && <>{renderDots("animated")}</>}
                {!isResting && isHovered && !isListening && !isProcessing && (
                  <>{renderDots("static")}</>
                )}
                {isResting && <div className="resting-indicator" />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default Pill;