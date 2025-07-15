import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

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

const Pill: React.FC<PillProps> = ({
  isListening,
  isProcessing,
  isHovered,
  notificationPlay,
  onStartDictation,
  onStopDictation,
  onHoverChange,
}) => {
  // --- Constants ---
  const VISUALIZATION_COUNT = 7;
  const PILL_RESTING_HEIGHT = 9; // Keep in sync with CSS
  const PILL_EXPANDED_HEIGHT = 30; // Keep in sync with CSS
  const PILL_EXPANDED_WIDTH = 207; // Keep in sync with CSS

  // --- Animation Variants ---
  const transition = {
    duration: 0.3, // Faster animation
    ease: "easeInOut" as const,
  }; // Use a tween for smoother easing

  // --- Dynamic Style Calculation ---
  const getPillStyles = () => {
    // A notification play takes absolute priority.
    if (notificationPlay) {
      if (notificationPlay.phase === "shrinking") {
        return {
          height: PILL_RESTING_HEIGHT,
          width: PILL_EXPANDED_WIDTH, // Start at normal width before shrinking text appears
        };
      }
      // Phase is 'showing'
      const basePadding = 40;
      const charWidth = 8;
      const maxWidth = 560;
      const calculatedWidth = basePadding + notificationPlay.text.length * charWidth;
      return {
        height: PILL_EXPANDED_HEIGHT,
        width: Math.max(
          PILL_EXPANDED_WIDTH,
          Math.min(calculatedWidth, maxWidth),
        ),
      };
    }

    // Default behavior when no notification is playing.
    const isExpanded = isListening || isProcessing || isHovered;
    return {
      height: isExpanded ? PILL_EXPANDED_HEIGHT : PILL_RESTING_HEIGHT,
      width: PILL_EXPANDED_WIDTH,
    };
  };

  const pillStyles = getPillStyles();
  const isShowingNotification = notificationPlay?.phase === "showing";

  // --- Resize Effect ---
  // When the calculated styles change, tell the main process.
  useEffect(() => {
    window.electron.resizePill(pillStyles.width);
  }, [pillStyles.width]);

  // Generate frequency bars for the waveform (active state)
  const renderFrequencyBars = () => {
    // Create bars with consistent count
    return Array.from({ length: VISUALIZATION_COUNT }).map((_, index) => (
      <div
        key={`bar-${index}`}
        className="waveform-bar"
        style={{
          animationDelay: `${index * 0.1}s`,
          height: `${3 + Math.random() * 5}px`,
        }}
      />
    ));
  };

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

  // The 'resting' state is now determined by the calculated height.
  const isResting = pillStyles.height === PILL_RESTING_HEIGHT;

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
        animate={pillStyles}
        transition={transition}
      >
        <div className="pill-content flex items-center justify-center w-full h-full">
          <AnimatePresence mode="wait">
            {isShowingNotification ? (
              <motion.span
                key="notification"
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
                {!isResting && isListening && <>{renderFrequencyBars()}</>}
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