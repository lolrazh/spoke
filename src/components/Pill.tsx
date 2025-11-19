import React, { useLayoutEffect, useRef, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MOTION } from "../config/motionTokens";
import SettingsPanel from "./SettingsPanel";
import PermissionsPanel from "./PermissionsPanel";
import SfIcon from "./icons/SfIcon";
import FrequencyBars from "./FrequencyBars";

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
    notifAction?: string | null;
  };
  notifWidth: number | null;
  isTextTruncated: boolean;
  audioLevel: number;
  dims: {
    baseW: number;
    baseH: number;
    restingH: number;
    expandedW: number;
    expandedH: number;
    maxW: number;
  };
  onStartDictation: () => void;
  onStopDictation: () => void;
  onHoverChange: (hovering: boolean) => void;
  onMetrics: (metrics: PillMetrics) => void;
  onAnimDone: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onToggleFloatingBar?: (enabled: boolean) => void;
  onNotificationAction?: (actionId: string) => void;
  shareTranscriptionsEnabled?: boolean;
  shareTranscriptionsLoading?: boolean;
  shareTranscriptionsUpdating?: boolean;
  onShareTranscriptionsChange?: (enabled: boolean) => void;
  panelView: "settings" | "permissions";
  onSettingsPanelHeightChange?: (height: number) => void;
  onPermissionsPanelHeightChange?: (height: number) => void;
}

const Pill: React.FC<PillProps> = ({
  pillState,
  pillContext,
  audioLevel,
  onStartDictation,
  onStopDictation,
  onHoverChange,
  onMetrics,
  onAnimDone,
  notifWidth,
  isTextTruncated,
  dims,
  onMouseEnter,
  onMouseLeave,
  onExpand,
  onCollapse,
  onToggleFloatingBar,
  onNotificationAction,
  shareTranscriptionsEnabled,
  shareTranscriptionsLoading,
  shareTranscriptionsUpdating,
  onShareTranscriptionsChange,
  panelView,
  onSettingsPanelHeightChange,
  onPermissionsPanelHeightChange,
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

  // Unified function to render animated dots (for processing state only)
  const renderDots = (type: "animated") => {
    return Array.from({ length: 7 }).map((_, index) => (
      <div
        key={`dot-${type}-${index}`}
        className={`dot ${type}`}
        style={{ animationDelay: `${index * 0.06}s` }}
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

    if (
      pillState === "NOTIFICATION" &&
      pillContext.notifAction &&
      onNotificationAction
    ) {
      onNotificationAction(pillContext.notifAction);
      return;
    }
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

    // Disable double-click collapse. Only allow double-click to expand.
    if (!isExpanded) {
      onExpand();
    }
  };

  // Build dynamic animation target
  const notificationTargetWidth = notifWidth ?? dims.baseW; // fallback

  // We'll drive width/height via explicit animate prop (overrides variants.width)
  const animateForState = (() => {
    switch (pillState) {
      case "IDLE":
        return { width: dims.baseW, height: dims.restingH };
      case "HOVER_PREVIEW":
      case "LISTENING":
      case "PROCESSING":
        return { width: dims.baseW, height: dims.baseH };
      case "NOTIFICATION":
        return { width: notificationTargetWidth, height: dims.baseH };
      case "EXPANDED":
        return { width: dims.expandedW, height: dims.expandedH };
      default:
        return {};
    }
  })();

  // Micro-physics: tiny overshoot on every state transition (except expanded)
  const shouldImpactPulse =
    previousStateRef.current !== pillState && !isExpanded;
  const animateWithImpact = shouldImpactPulse
    ? { ...animateForState, scale: [1, 1.006, 1] }
    : { ...animateForState, scale: 1 };

  // State-specific spring feel
  const transitionForState = (() => {
    const isReturningToIdle =
      pillState === "IDLE" && previousStateRef.current !== "IDLE";
    switch (pillState) {
      case "HOVER_PREVIEW":
        return { type: "spring" as const, ...MOTION.springs.lively };
      case "LISTENING":
        // Ultra-snappy expansion for immediate feedback
        return { type: "spring" as const, ...MOTION.springs.instant };
      case "PROCESSING":
        return { type: "spring" as const, ...MOTION.springs.instant };
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

  // Micro-physics transition for the overshoot pulse
  const transitionWithImpact = shouldImpactPulse
    ? {
        ...transitionForState,
        // Use a snappy spring for the tiny scale pulse
        scale: {
          type: "spring" as const,
          stiffness: 600,
          damping: 32,
          mass: 0.5,
        },
        // Spring chain: width leads, height follows by a hair
        width: { ...(transitionForState as unknown as Record<string, unknown>) },
        height: { ...(transitionForState as unknown as Record<string, unknown>), delay: 0.015 },
      }
    : transitionForState;

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
        animate={animateWithImpact}
        transition={transitionWithImpact}
        onAnimationComplete={() => {
          // Only advance the FSM when the *shrink back to idle* finishes
          if (pillState !== "NOTIFICATION") {
            onAnimDone();
          }
        }}
      >
        {/* Afterglow overlay: subtle fade right after state changes */}
        {!isExpanded && shouldImpactPulse && (
          <motion.div
            key={`impact-glow-${pillState}`}
            className="impact-glow-overlay"
            initial={{ opacity: 0.03 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          />
        )}
        <div className="pill-content flex items-center justify-center w-full h-full">
          <AnimatePresence mode="wait">
            {isExpanded ? (
              <motion.div
                key="panel-content"
                className="w-full h-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: MOTION.durations.standard }}
              >
                <div className="w-full h-full relative">
                  {panelView === "permissions" ? (
                    <PermissionsPanel
                      onHeightChange={onPermissionsPanelHeightChange}
                    />
                  ) : (
                    <SettingsPanel
                      embeddedMode={true}
                      onToggleFloatingBar={onToggleFloatingBar}
                      onRequestCollapse={onCollapse}
                      shareTranscriptionsEnabled={shareTranscriptionsEnabled}
                      shareTranscriptionsLoading={shareTranscriptionsLoading}
                      shareTranscriptionsUpdating={shareTranscriptionsUpdating}
                      onShareTranscriptionsChange={onShareTranscriptionsChange}
                      onHeightChange={onSettingsPanelHeightChange}
                    />
                  )}
                  {/* Collapse chevron at bottom */}
                  <button
                    className="pill-collapse-btn absolute bottom-2 left-1/2 transform -translate-x-1/2"
                    onClick={onCollapse}
                    aria-label="Collapse"
                  >
                    <SfIcon name="chevron.up" size={14} />
                  </button>
                </div>
              </motion.div>
            ) : isShowingNotification ? (
              <motion.span
                key="notification"
                className={`notification-text ${isTextTruncated ? "truncated" : ""} ${
                  pillContext.notifAction ? "cursor-pointer" : ""
                }`}
                role={pillContext.notifAction ? "button" : undefined}
                tabIndex={pillContext.notifAction ? 0 : undefined}
                onKeyDown={
                  pillContext.notifAction && onNotificationAction
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onNotificationAction(pillContext.notifAction!);
                        }
                      }
                    : undefined
                }
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
                {pillState === "LISTENING" && (
                  <FrequencyBars
                    audioLevel={audioLevel}
                    isListening={true}
                    isIdle={false}
                    isHovered={false}
                    isProcessing={false}
                  />
                )}
                {pillState === "PROCESSING" && (
                  <FrequencyBars
                    audioLevel={0}
                    isListening={false}
                    isIdle={false}
                    isHovered={false}
                    isProcessing={true}
                  />
                )}
                {pillState === "HOVER_PREVIEW" && (
                  <FrequencyBars
                    audioLevel={0}
                    isListening={false}
                    isIdle={false}
                    isHovered={true}
                    isProcessing={false}
                  />
                )}
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
