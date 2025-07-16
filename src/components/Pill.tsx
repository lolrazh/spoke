import React, { useState, useLayoutEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PILL_ANIMATION_DURATION } from "../constants/animations";

// Update the type for our new "notification play" prop
type NotificationPlay = {
  text: string;
  phase: "shrinking" | "showing";
} | null;

interface PillProps {
  isListening: boolean;
  isProcessing: boolean;
  isHovered: boolean;
  notificationPlay: NotificationPlay;
  onStartDictation: () => void;
  onStopDictation: () => void;
  onHoverChange: (hovered: boolean) => void;
}

// Helper function to read CSS variables from the DOM
const getCssVar = (name: string): number => {
  if (typeof window === "undefined") return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return parseInt(value, 10) || 0;
};

const Pill: React.FC<PillProps> = ({
  isListening,
  isProcessing,
  isHovered,
  notificationPlay,
  onStartDictation,
  onStopDictation,
  onHoverChange,
}) => {
  // --- Refs ---
  const textRef = useRef<HTMLSpanElement>(null);
  const lastSentWidthRef = useRef<number | null>(null);

  // --- Read constants from CSS ---
  const PILL_EXPANDED_WIDTH = useMemo(() => getCssVar("--pill-expanded-width"), []);
  const PILL_EXPANDED_HEIGHT = useMemo(() => getCssVar("--pill-expanded-height"), []);
  const PILL_RESTING_HEIGHT = useMemo(() => getCssVar("--pill-resting-height"), []);

  // --- State ---
  const [pillWidth, setPillWidth] = useState(PILL_EXPANDED_WIDTH); // Default width

  // --- Constants ---
  const VISUALIZATION_COUNT = 7;
  const NOTIFICATION_MAX_WIDTH = 560;
  const NOTIFICATION_PADDING = 40;

  // --- Animation Variants ---
  const transition = {
    duration: PILL_ANIMATION_DURATION / 1000, // Convert ms to seconds for Framer Motion
    ease: "easeInOut" as const,
  };

  // --- Core Sizing and Resize Logic ---
  useLayoutEffect(() => {
    let targetWidth = PILL_EXPANDED_WIDTH;

    if (notificationPlay?.phase === "showing" && textRef.current) {
      const measuredWidth = textRef.current.offsetWidth + NOTIFICATION_PADDING;
      targetWidth = Math.max(
        PILL_EXPANDED_WIDTH,
        Math.min(measuredWidth, NOTIFICATION_MAX_WIDTH),
      );
    }
    
    // On initial mount, pillWidth can be 0, so we initialize it
    if (pillWidth === 0 && PILL_EXPANDED_WIDTH > 0) {
      setPillWidth(PILL_EXPANDED_WIDTH);
    }

    setPillWidth(targetWidth);

    // Only send resize command if the width actually changes
    if (lastSentWidthRef.current !== targetWidth) {
      window.electron.resizePill(targetWidth);
      lastSentWidthRef.current = targetWidth;
    }
  }, [notificationPlay, PILL_EXPANDED_WIDTH]); // Re-run if the CSS var changes

  // --- Height Calculation ---
  const getPillHeight = () => {
    if (notificationPlay?.phase === "shrinking") {
      return PILL_RESTING_HEIGHT;
    }
    const isExpanded = isListening || isProcessing || isHovered || !!notificationPlay;
    return isExpanded ? PILL_EXPANDED_HEIGHT : PILL_RESTING_HEIGHT;
  };

  const pillHeight = getPillHeight();
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
                ref={textRef}
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