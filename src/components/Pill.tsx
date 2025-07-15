import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface PillProps {
  isListening: boolean;
  isProcessing: boolean;
  isHovered: boolean;
  notificationText: string | null;
  onStartDictation: () => void;
  onStopDictation: () => void;
  onHoverChange: (hovered: boolean) => void;
}

const Pill: React.FC<PillProps> = ({
  isListening,
  isProcessing,
  isHovered,
  notificationText,
  onStartDictation,
  onStopDictation,
  onHoverChange,
}) => {
  // --- Constants ---
  const VISUALIZATION_COUNT = 7;
  const PILL_RESTING_WIDTH = 70; // Keep in sync with CSS
  const PILL_EXPANDED_WIDTH = 207; // Keep in sync with CSS

  // --- Animation Variants ---
  const spring = { type: "spring" as const, stiffness: 480, damping: 40 };

  // --- Dynamic Width Calculation (Estimation Method) ---
  const calculateWidth = (text: string | null): number => {
    if (!text) {
      // When there's no notification, use the standard expanded width.
      return PILL_EXPANDED_WIDTH;
    }
    // When there IS a notification, estimate width based on text length.
    const basePadding = 40; // 20px on each side
    const charWidth = 8; // A more generous average width per character
    const maxWidth = 560;
    const calculatedWidth = basePadding + text.length * charWidth;

    // Ensure the pill is at least its standard width and not over the max width.
    return Math.max(
      PILL_EXPANDED_WIDTH,
      Math.min(calculatedWidth, maxWidth),
    );
  };

  // --- Resize Effect ---
  // When the notification text changes, calculate the new width and tell the main process.
  useEffect(() => {
    const newWidth = calculateWidth(notificationText);
    window.electron.resizePill(newWidth);
  }, [notificationText]);

  const isShowingNotification = !!notificationText;

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

  // Determine the current state - now always visible, just different sizes
  const isResting =
    !isHovered && !isListening && !isProcessing && !isShowingNotification;
  const isExpanded =
    isHovered || isListening || isProcessing || isShowingNotification;

  return (
    <div
      className={`
        pill-wrapper transition-all duration-300 ease-out
        ${isResting ? "resting-state" : ""}
        ${isExpanded ? "expanded-state" : ""}
        ${isListening ? "listening" : ""}
        ${isProcessing ? "processing" : ""}
      `}
      onClick={isListening ? onStopDictation : onStartDictation}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <motion.div
        className="pill-core"
        initial={false}
        animate={{ width: calculateWidth(notificationText) }}
        transition={spring}
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
                {notificationText}
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
                {/* 
                  We now render the content of the visualizer directly inside a motion.div 
                  that has the .visualization-container class, preserving the original layout.
                */}
                {isResting && <div className="resting-indicator" />}

                {isHovered && !isListening && !isProcessing && (
                  <>{renderDots("static")}</>
                )}

                {isListening && <>{renderFrequencyBars()}</>}

                {isProcessing && !isListening && (
                  <>{renderDots("animated")}</>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default Pill;