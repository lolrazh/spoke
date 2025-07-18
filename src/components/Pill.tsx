import React, { useLayoutEffect, useRef, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TOKENS } from "../config/uiTokens";
import HomePage from "./HomePage";

type PillMetrics = {
  pillRect: DOMRect | null;
  notificationText: string | null;
  devicePixelRatio: number;
};

// Use PillStateType from App.tsx
import type { PillStateType, PillMachineState } from "./App";

interface PillProps {
  pillState: PillStateType;
  pillContext: PillMachineState["context"];
  notifWidth: number | null;
  isTextTruncated: boolean;
  onStartDictation: () => void;
  onStopDictation: () => void;
  onHoverChange: (hovered: boolean) => void;
  onMetrics: (metrics: PillMetrics) => void;
  onAnimDone: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onExpand: () => void;
  onCollapse: () => void;
}

// Helper function to read CSS variables from the DOM, with a fallback
const getCssVar = (name: string, fallback: number): number => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    name,
  );
  const parsedValue = parseInt(value, 10);
  return isNaN(parsedValue) ? fallback : parsedValue;
};

const Pill: React.FC<PillProps> = ({
  pillState,
  pillContext,
  onStartDictation,
  onStopDictation,
  onHoverChange,
  onMetrics,
  onAnimDone,
  notifWidth,
  isTextTruncated,
  onMouseEnter,
  onMouseLeave,
  onExpand,
  onCollapse,
}) => {
  // --- Refs ---
  const pillCoreRef = useRef<HTMLDivElement>(null);

  // --- Metrics Reporting ---
  useLayoutEffect(() => {
    if (!onMetrics) return;

    const pillRect = pillCoreRef.current?.getBoundingClientRect() ?? null;

    onMetrics({
      pillRect,
      notificationText: pillContext.notifMsg ?? null,
      devicePixelRatio: window.devicePixelRatio,
    });
  }, [pillState, pillContext, onMetrics]);

  const isShowingNotification = pillState === "NOTIFICATION";
  const isListening = pillState === "LISTENING";
  const isResting = pillState === "IDLE";
  const isProcessing = pillState === "PROCESSING";
  const isHovered = pillState === "HOVER_PREVIEW";
  const isExpanded = pillState === "EXPANDED";

  useEffect(() => {
    console.log(
      `[Pill] State: ${pillState}, isResting=${isResting}, isListening=${isListening}, isProcessing=${isProcessing}, isHovered=${isHovered}, isExpanded=${isExpanded}`,
    );
  }, [pillState, isResting, isListening, isProcessing, isHovered, isExpanded]);

  // Handle escape key to close expanded view
  useEffect(() => {
    if (!isExpanded) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCollapse();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isExpanded, onCollapse]);

  // Generate frequency bars for the waveform (active state)
  const renderFrequencyBars = useMemo(
    () =>
      // Create bars with consistent count
      Array.from({ length: 7 }).map((_, index) => (
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
    return Array.from({ length: 7 }).map((_, index) => (
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

  // Handle double-click to expand/collapse
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isExpanded) {
      onCollapse();
    } else {
      onExpand();
    }
  };

  // Build dynamic animation target
  const notificationTargetWidth = notifWidth ?? TOKENS.PILL_BASE_W; // fallback

  // We'll drive width/height via explicit animate prop (overrides variants.width)
  const animateForState = (() => {
    switch (pillState) {
      case "IDLE":
        return { width: TOKENS.PILL_BASE_W, height: TOKENS.PILL_RESTING_H };
      case "HOVER_PREVIEW":
      case "LISTENING":
      case "PROCESSING":
        return { width: TOKENS.PILL_BASE_W, height: TOKENS.PILL_BASE_H };
      case "NOTIFICATION":
        return { width: notificationTargetWidth, height: TOKENS.PILL_BASE_H };
      case "EXPANDED":
        return { width: 600, height: 620 };
      default:
        return {};
    }
  })();

  return (
    <div
      className="pill-wrapper"
      onClick={isExpanded ? undefined : (isListening ? onStopDictation : onStartDictation)}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => {
        onHoverChange(true);
        onMouseEnter();
      }}
      onMouseLeave={() => {
        onHoverChange(false);
        onMouseLeave();
      }}
    >
      <motion.div
        ref={pillCoreRef}
        className={`pill-core ${isExpanded ? "expanded" : ""}`}
        layout
        initial={false}
        animate={animateForState}
        onAnimationComplete={() => {
          // Only advance the FSM when the *shrink back to idle* finishes
          if (pillState !== "NOTIFICATION") {
            onAnimDone();
          }
        }}
      >
        <div className="pill-content flex items-center justify-center w-full h-full">
          <AnimatePresence mode="wait">
            {isExpanded ? (
              <motion.div
                key="home-content"
                className="w-full h-full relative"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <HomePage embeddedMode={true} />
                {/* Collapse chevron at bottom */}
                <button
                  className="absolute bottom-3 left-1/2 transform -translate-x-1/2 w-8 h-6 bg-black/20 hover:bg-black/40 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
                  onClick={onCollapse}
                  aria-label="Collapse"
                >
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="currentColor">
                    <path d="M6 0L0 6h12L6 0z"/>
                  </svg>
                </button>
              </motion.div>
            ) : isShowingNotification ? (
              <motion.span
                key="notification"
                className={`notification-text ${isTextTruncated ? "truncated" : ""}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {pillContext.notifMsg}
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
                {pillState === "LISTENING" && <>{renderFrequencyBars}</>}
                {pillState === "PROCESSING" && <>{renderDots("animated")}</>}
                {pillState === "HOVER_PREVIEW" && <>{renderDots("static")}</>}
                {pillState === "IDLE" && <div className="resting-indicator" />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default Pill;
