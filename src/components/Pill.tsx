import React, { useLayoutEffect, useRef, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TOKENS } from "../config/uiTokens";
import { MOTION } from "../config/motionTokens";
import HomePage from "./HomePage";

type PillMetrics = {
  pillRect: DOMRect | null;
  notificationText: string | null;
  devicePixelRatio: number;
};

// Use PillStateType from App.tsx
import type { PillStateType } from "./App";

interface PillProps {
  pillState: PillStateType;
  pillContext: {
    pendingNotif?: string;
    notifMsg?: string;
  };
  notifWidth: number | null;
  isTextTruncated: boolean;
  onStartDictation: () => void;
  onStopDictation: () => void;
  onHoverChange: (hovering: boolean) => void;
  onMetrics: (metrics: PillMetrics) => void;
  onAnimDone: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onExpand: () => void;
  onCollapse: () => void;
}

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
  const previousStateRef = useRef<PillStateType>(pillState);

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

  // Track previous state to detect transitions into IDLE
  useEffect(() => {
    previousStateRef.current = pillState;
  }, [pillState]);

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

  // Cleanup click timeout on unmount
  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

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

  // Handle click timing for single vs double click
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleClick = () => {
    if (isExpanded) return;

    // Clear any existing timeout
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }

    // Set a timeout for single click
    clickTimeoutRef.current = setTimeout(() => {
      if (isListening) {
        onStopDictation();
      } else {
        onStartDictation();
      }
      clickTimeoutRef.current = null;
    }, 200); // 200ms delay to distinguish from double-click
  };

  // Handle double-click to expand/collapse
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Clear single click timeout
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }

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
        return { width: 600, height: 610 };
      default:
        return {};
    }
  })();

  // State-specific spring feel
  const transitionForState = (() => {
    const isReturningToIdle = pillState === "IDLE" && previousStateRef.current !== "IDLE";
    switch (pillState) {
      case "HOVER_PREVIEW":
      case "LISTENING":
        return { type: "spring" as const, ...MOTION.springs.lively };
      case "PROCESSING":
      case "NOTIFICATION":
        return { type: "spring" as const, ...MOTION.springs.quick };
      case "IDLE":
        return {
          type: "spring" as const,
          ...(isReturningToIdle ? MOTION.springs.settle : MOTION.springs.quick),
        };
      case "EXPANDED":
        return { type: "spring" as const, ...MOTION.springs.heavy };
      default:
        return { type: "spring" as const, ...MOTION.springs.quick };
    }
  })();

  return (
    <div
      className="pill-wrapper"
      onClick={handleClick}
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
        transition={transitionForState}
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
                transition={{ duration: MOTION.durations.standard }}
              >
                <HomePage embeddedMode={true} />
                {/* Collapse chevron at bottom */}
                <button
                  className="absolute bottom-2 left-1/2 transform -translate-x-1/2 w-10 h-8 bg-black/20 hover:bg-black/40 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
                  onClick={onCollapse}
                  aria-label="Collapse"
                >
                  <svg
                    width="16"
                    height="10"
                    viewBox="0 0 16 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 7L8 3L12 7" />
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
                transition={{ duration: MOTION.durations.fast / 2 }}
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
                transition={{ duration: MOTION.durations.fast / 2 }}
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
