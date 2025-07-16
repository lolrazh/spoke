import React, { useLayoutEffect, useRef, useMemo, useEffect } from "react";
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

// Use PillStateType from App.tsx
import type { PillStateType } from './App';
import type { PillMachineState } from './App';

interface PillProps {
  pillState: PillStateType;
  pillContext: PillMachineState['context'];
  onStartDictation: () => void;
  onStopDictation: () => void;
  onHoverChange: (hovered: boolean) => void;
  onMetrics: (metrics: PillMetrics) => void;
  onAnimDone: () => void;
}

// Helper function to read CSS variables from the DOM, with a fallback
const getCssVar = (name: string, fallback: number): number => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
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
}) => {
  // --- Refs ---
  const pillCoreRef = useRef<HTMLDivElement>(null);

  // --- Ghost Measurement ---
  const ghostWidth = useGhostMeasure(pillContext.notifMsg ?? "");

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

  // --- Height Calculation ---
  const pillHeight = useMemo(() => {
    switch (pillState) {
      case 'IDLE':
      case 'NOTIF_SHRINK':
        return PILL_RESTING_HEIGHT;
      default:
        return PILL_EXPANDED_HEIGHT;
    }
  }, [pillState, PILL_EXPANDED_HEIGHT, PILL_RESTING_HEIGHT]);

  useEffect(() => {
    console.log(`[Pill] pillHeight changed to: ${pillHeight}`);
  }, [pillHeight]);

  // --- Constants ---
  const VISUALIZATION_COUNT = 7;

  // --- Animation Variants ---
  const transition = {
    duration: PILL_ANIMATION_DURATION / 1000, // Convert ms to seconds for Framer Motion
    ease: "easeInOut" as const,
  };

  // --- Target Width Calculation ---
  const targetWidth = useMemo(() => {
    if (pillState === 'NOTIF_SHOW' && pillContext.notifWidth) {
      return pillContext.notifWidth;
    }
    return PILL_EXPANDED_WIDTH;
  }, [pillState, pillContext, PILL_EXPANDED_WIDTH]);

  useEffect(() => {
    console.log(`[Pill] targetWidth changed to: ${targetWidth} (ghostWidth: ${ghostWidth})`);
  }, [targetWidth, ghostWidth]);

  // --- Metrics Reporting ---
  useLayoutEffect(() => {
    if (!onMetrics) return;

    const pillRect = pillCoreRef.current?.getBoundingClientRect() ?? null;

    onMetrics({
      pillRect,
      notificationText: pillContext.notifMsg ?? null,
      devicePixelRatio: window.devicePixelRatio,
    });
  }, [
    targetWidth, // Use targetWidth instead of pillWidth
    pillContext,
    onMetrics,
    pillHeight,
  ]);

  const isShowingNotification = pillState === 'NOTIF_SHOW';
  const isResting = pillHeight === PILL_RESTING_HEIGHT;
  const isListening = pillState === 'LISTENING';
  const isProcessing = pillState === 'PROCESSING';
  const isHovered = pillState === 'HOVER_PREVIEW';

  useEffect(() => {
    console.log(`[Pill] State: ${pillState}, isResting=${isResting}, isListening=${isListening}, isProcessing=${isProcessing}, isHovered=${isHovered}`);
  }, [pillState, isResting, isListening, isProcessing, isHovered]);

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
      className="pill-wrapper"
      onClick={isListening ? onStopDictation : onStartDictation}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <motion.div
        ref={pillCoreRef}
        className="pill-core overflow-hidden"
        layout
        initial={false}
        style={{
          width: targetWidth,
          height: pillHeight,
        }}
        transition={transition}
        onAnimationComplete={onAnimDone}
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
                {isListening && <>{renderFrequencyBars}</>}
                {isProcessing && <>{renderDots("animated")}</>}
                {isHovered && !isListening && !isProcessing && (
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