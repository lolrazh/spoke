import React, {
  useCallback,
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useEffect,
  useState,
} from "react";
import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import { MOTION } from "../config/motionTokens";
import SfIcon from "./icons/SfIcon";
import {
  HoverFrequencyBars,
  ListeningFrequencyBars,
  ProcessingFrequencyBars,
} from "./FrequencyBars";
import {
  LiveTranscript,
  LiveTranscriptFromStore,
  type LiveTranscriptMetrics,
} from "./LiveTranscript";
import { calculateLiveTranscriptLayout } from "./liveTranscriptLayout";
import { useLiveTranscriptActive } from "../state/liveTranscript";

type PillMetrics = {
  pillRect: DOMRect | null;
  notificationText: string | null;
  devicePixelRatio: number;
};

import type { PillStateType } from "../state/pillStateMachine";

const SettingsPanel = lazy(() => {
  window.electron?.bootMark?.("settings-panel:import:start");
  return import("./SettingsPanel").then((module) => {
    window.electron?.bootMark?.("settings-panel:import:done");
    return module;
  });
});

const PermissionsPanel = lazy(() => {
  window.electron?.bootMark?.("permissions-panel:import:start");
  return import("./PermissionsPanel").then((module) => {
    window.electron?.bootMark?.("permissions-panel:import:done");
    return module;
  });
});

const PanelLoadingFallback: React.FC = () => (
  <div className="flex h-full w-full items-center justify-center text-[13px] text-primary/50">
    Loading...
  </div>
);

interface PillProps {
  pillState: PillStateType;
  pillContext: {
    pendingNotif?: string;
    notifMsg?: string;
    notifAction?: string | null;
  };
  /** Optional test/embedding override; production reads the external store. */
  liveTranscript?: string;
  notifWidth: number | null;
  isTextTruncated: boolean;
  dims: {
    baseW: number;
    baseH: number;
    restingH: number;
    expandedW: number;
    expandedH: number;
    maxW: number;
  };
  onHoverChange: (hovering: boolean) => void;
  onMetrics?: (metrics: PillMetrics) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onToggleFloatingBar?: (enabled: boolean) => void;
  onNotificationAction?: (actionId: string) => void;
  panelView: "settings" | "permissions";
  initialSettingsTab?: "settings" | "history";
  onSettingsPanelHeightChange?: (height: number) => void;
  onPermissionsPanelHeightChange?: (height: number) => void;
}

const Pill: React.FC<PillProps> = ({
  pillState,
  pillContext,
  liveTranscript: liveTranscriptOverride,
  onHoverChange,
  onMetrics,
  notifWidth,
  isTextTruncated,
  dims,
  onMouseEnter,
  onMouseLeave,
  onExpand,
  onCollapse,
  onToggleFloatingBar,
  onNotificationAction,
  panelView,
  initialSettingsTab,
  onSettingsPanelHeightChange,
  onPermissionsPanelHeightChange,
}) => {
  // --- Refs ---
  const liveTranscriptActive = useLiveTranscriptActive();
  const pillCoreRef = useRef<HTMLDivElement>(null);
  const previousStateRef = useRef<PillStateType>(pillState);
  const reduceMotion = useReducedMotion() ?? false;
  const [liveTranscriptMetrics, setLiveTranscriptMetrics] =
    useState<LiveTranscriptMetrics & { maxWrappedTextHeight: number }>({
      wrappedTextHeight: 0,
      maxWrappedTextHeight: 0,
    });

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
  const isExpanded = pillState === "EXPANDED";
  const liveTranscriptIsActive =
    liveTranscriptOverride === undefined
      ? liveTranscriptActive
      : liveTranscriptOverride.length > 0;
  const hasLiveTranscript =
    (pillState === "LISTENING" || pillState === "PROCESSING") &&
    liveTranscriptIsActive;
  const notificationAction = pillContext.notifAction ?? null;

  const handleLiveTextMetricsChange = useCallback(
    (metrics: LiveTranscriptMetrics) => {
      setLiveTranscriptMetrics((previous) =>
        previous.wrappedTextHeight === metrics.wrappedTextHeight
          ? previous
          : {
              wrappedTextHeight: metrics.wrappedTextHeight,
              maxWrappedTextHeight: Math.max(
                previous.maxWrappedTextHeight,
                metrics.wrappedTextHeight,
              ),
            },
      );
    },
    [],
  );

  useEffect(() => {
    if (hasLiveTranscript) return;
    setLiveTranscriptMetrics({
      wrappedTextHeight: 0,
      maxWrappedTextHeight: 0,
    });
  }, [hasLiveTranscript]);

  const liveTranscriptLayout = calculateLiveTranscriptLayout({
    wrappedTextHeight: liveTranscriptMetrics.wrappedTextHeight,
    maxWrappedTextHeight: liveTranscriptMetrics.maxWrappedTextHeight,
    baseWidth: dims.baseW,
    baseHeight: dims.baseH,
    maxWidth: dims.maxW,
  });

  // (Removed noisy state logging)

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

  const handleClick = () => {
    if (isExpanded) return;

    if (
      pillState === "NOTIFICATION" &&
      notificationAction &&
      onNotificationAction
    ) {
      onNotificationAction(notificationAction);
      return;
    }
  };

  // Handle double-click to expand/collapse
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

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
        return { width: dims.baseW, height: dims.baseH };
      case "LISTENING":
      case "PROCESSING":
        return {
          width: hasLiveTranscript
            ? liveTranscriptLayout.pillWidth
            : dims.baseW,
          height: hasLiveTranscript
            ? liveTranscriptLayout.pillHeight
            : dims.baseH,
        };
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
    if (reduceMotion) return { duration: 0 };
    if (
      hasLiveTranscript &&
      (pillState === "LISTENING" || pillState === "PROCESSING")
    ) {
      return { type: "spring" as const, ...MOTION.springs.transcript };
    }
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
        width: {
          ...(transitionForState as unknown as Record<string, unknown>),
        },
        height: {
          ...(transitionForState as unknown as Record<string, unknown>),
          delay: 0.015,
        },
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
      <m.div
        ref={pillCoreRef}
        className={`pill-core ${isExpanded ? "expanded" : ""} ${
          hasLiveTranscript ? "has-live-transcript" : ""
        }`}
        initial={false}
        animate={animateWithImpact}
        transition={transitionWithImpact}
      >
        {/* Afterglow overlay: subtle fade right after state changes */}
        {!isExpanded && shouldImpactPulse && (
          <m.div
            key={`impact-glow-${pillState}`}
            className="impact-glow-overlay"
            initial={{ opacity: 0.03 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          />
        )}
        <div className="pill-content flex items-center justify-center w-full h-full">
          <span className="sr-only" role="status">
            {hasLiveTranscript ? "Live transcription active" : ""}
          </span>
          <AnimatePresence mode="wait">
            {isExpanded ? (
              <m.div
                key="panel-content"
                className="w-full h-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: MOTION.durations.standard }}
              >
                <div className="w-full h-full relative">
                  <Suspense fallback={<PanelLoadingFallback />}>
                    {panelView === "permissions" ? (
                      <PermissionsPanel
                        onHeightChange={onPermissionsPanelHeightChange}
                      />
                    ) : (
                      <SettingsPanel
                        embeddedMode={true}
                        onToggleFloatingBar={onToggleFloatingBar}
                        onRequestCollapse={onCollapse}
                        onHeightChange={onSettingsPanelHeightChange}
                        initialTab={initialSettingsTab}
                      />
                    )}
                  </Suspense>
                  {/* Collapse chevron at bottom */}
                  <button
                    className="pill-collapse-btn absolute bottom-2 left-1/2 transform -translate-x-1/2 z-30"
                    onClick={onCollapse}
                    aria-label="Collapse"
                  >
                    <SfIcon name="chevron.up" size={14} />
                  </button>
                </div>
              </m.div>
            ) : isShowingNotification ? (
              <m.span
                key="notification"
                className={`notification-text ${isTextTruncated ? "truncated" : ""} ${
                  notificationAction ? "cursor-pointer" : ""
                }`}
                role={notificationAction ? "button" : undefined}
                tabIndex={notificationAction ? 0 : undefined}
                onKeyDown={
                  notificationAction && onNotificationAction
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onNotificationAction(notificationAction);
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
              </m.span>
            ) : (
              <m.div
                key="visualizer"
                className={
                  hasLiveTranscript
                    ? "live-transcript-container"
                    : "visualization-container"
                }
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: MOTION.durations.fast / 2 }}
              >
                {/* Visuals for non-notification states */}
                {hasLiveTranscript ? (
                  liveTranscriptOverride === undefined ? (
                    <LiveTranscriptFromStore
                      isProcessing={pillState === "PROCESSING"}
                      textWidth={liveTranscriptLayout.textWidth}
                      visibleTextHeight={liveTranscriptLayout.visibleTextHeight}
                      railOffsetY={liveTranscriptLayout.railOffsetY}
                      overflowing={liveTranscriptLayout.overflowing}
                      reducedMotion={reduceMotion}
                      onTextMetricsChange={handleLiveTextMetricsChange}
                    />
                  ) : (
                    <LiveTranscript
                      text={liveTranscriptOverride}
                      isProcessing={pillState === "PROCESSING"}
                      textWidth={liveTranscriptLayout.textWidth}
                      visibleTextHeight={liveTranscriptLayout.visibleTextHeight}
                      railOffsetY={liveTranscriptLayout.railOffsetY}
                      overflowing={liveTranscriptLayout.overflowing}
                      reducedMotion={reduceMotion}
                      onTextMetricsChange={handleLiveTextMetricsChange}
                    />
                  )
                ) : pillState === "LISTENING" ? (
                  <ListeningFrequencyBars />
                ) : pillState === "PROCESSING" ? (
                  <ProcessingFrequencyBars />
                ) : pillState === "HOVER_PREVIEW" ? (
                  <HoverFrequencyBars />
                ) : pillState === "IDLE" ? (
                  <div className="resting-indicator" />
                ) : null}
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </m.div>
    </div>
  );
};

// Memoized: during recording the audio level now lives in an external store,
// so Pill's props are stable frame-to-frame and it should not re-render on
// audio frames — only on genuine state transitions (its own props changing).
export default React.memo(Pill);
