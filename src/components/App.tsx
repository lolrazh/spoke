import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
  useMemo,
} from "react";
import Pill from "./Pill";
import { useTranscription } from "../hooks/useTranscription";
import {
  CONTENT_WIDTH,
  CONTENT_HEIGHT,
  SETTINGS_CONTENT_HEIGHT,
  PERMISSIONS_CONTENT_WIDTH,
  PERMISSIONS_CONTENT_HEIGHT,
} from "../constants/window";
import { MIN_UI_SCALE, MAX_UI_SCALE } from "../constants/display";
import { TOKENS } from "../config/uiTokens";
import {
  PermissionsProvider,
  useMissingPermissions,
} from "../state/permissionsContext";
import { usePttGestures } from "../hooks/usePttGestures";
import {
  usePermissionNotifications,
  PERMISSION_NOTIFICATION_ACTION_ID,
  PERMISSION_NOTIFICATION_DURATION_MS,
  PERMISSION_NOTIFICATION_REPEAT_DELAY_MS,
  PERMISSION_NOTIFICATION_INTERACTION_DELAY_MS,
} from "../hooks/usePermissionNotifications";
import { usePillMachine } from "../state/pillStateMachine";
export type {
  PillStateType,
  PillEvent,
  PillMachineState,
} from "../state/pillStateMachine";

// Notification timing tokens
const DEFAULT_NOTIFICATION_DURATION_MS = 2000;
let appRenderMarked = false;

const logPermissionsDebug = (...args: unknown[]) => {
  if (typeof window === "undefined") return;
  if (!window?.devFlags?.devConsoleLogs) return;
  try {
    console.debug("[Permissions]", new Date().toISOString(), ...args);
  } catch {
    // ignore logging errors
  }
};

type PillMetrics = {
  pillRect: DOMRect | null;
  notificationText: string | null;
  devicePixelRatio: number;
};

const AppInner: React.FC = () => {
  if (!appRenderMarked) {
    appRenderMarked = true;
    window.electron?.bootMark?.("app-render");
  }
  const [debugInfo, setDebugInfo] = useState<PillMetrics | null>(null);
  const [showDebug] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("debugPill");
  });
  const [uiScale, setUiScale] = useState(1);
  const [notchWidth, setNotchWidth] = useState<number | null>(null);
  const [settingsPanelMeasured, setSettingsPanelMeasured] = useState(false);
  const [settingsPanelContentHeight, setSettingsPanelContentHeight] =
    useState(SETTINGS_CONTENT_HEIGHT);
  const [permissionsPanelMeasured, setPermissionsPanelMeasured] =
    useState(false);
  const [permissionsPanelContentHeight, setPermissionsPanelContentHeight] =
    useState(PERMISSIONS_CONTENT_HEIGHT);
  const missingPermissions = useMissingPermissions();
  const [panelView, setPanelView] = useState<"settings" | "permissions">(
    "settings",
  );
  const autoPermissionsRef = useRef(false);
  const lastMissingCountRef = useRef<number>(missingPermissions.length);
  const wasProcessingRef = useRef(false);

  // Permission notification logic extracted into hook for cleaner callback dependencies
  const {
    triggerPermissionNotification,
    schedulePermissionNotification,
    clearPermissionNotificationLoop,
    isNotificationScheduled,
    missingCountRef,
    missingSignatureRef,
  } = usePermissionNotifications({ missingPermissions });

  // Track when paste shortcut (Cmd+Ctrl+V) was last pressed for history-on-expand UX
  const lastPasteShortcutTsRef = useRef<number | null>(null);
  // Initial tab for settings panel (computed on expand based on paste timing)
  const [initialSettingsTab, setInitialSettingsTab] = useState<
    "settings" | "history"
  >("settings");

  const handleSettingsPanelHeight = useCallback(
    (height: number) => {
      if (!Number.isFinite(height) || height <= 0) return;
      const normalized = Math.round(height);
      setSettingsPanelMeasured(true);
      setSettingsPanelContentHeight((prev) =>
        prev === normalized ? prev : normalized,
      );
    },
    [],
  );

  const handlePermissionsPanelHeight = useCallback(
    (height: number) => {
      if (!Number.isFinite(height) || height <= 0) return;
      const normalized = Math.round(height);
      setPermissionsPanelMeasured(true);
      setPermissionsPanelContentHeight((prev) =>
        prev === normalized ? prev : normalized,
      );
    },
    [],
  );

  useLayoutEffect(() => {
    window.electron?.bootMark?.("app-layout-effect");
    try {
      document.body.classList.remove("initial-fade");
    } catch {}
    try {
      window.electron?.rendererReady?.();
    } catch {}
  }, []);

  useEffect(() => {
    window.electron?.bootMark?.("app-effect:mounted");
  }, []);

  // Subscribe to paste shortcut events (Cmd+Ctrl+V) for history-on-expand UX
  useEffect(() => {
    const unsubscribe = window.electron?.onPasteShortcutPressed?.(() => {
      lastPasteShortcutTsRef.current = Date.now();
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const canProceedWithStart = useCallback(async (): Promise<boolean> => {
    try {
      const mic = await window.electron?.checkMicrophonePermission?.();
      if (!mic?.granted) {
        triggerPermissionNotification(
          "ptt",
          PERMISSION_NOTIFICATION_INTERACTION_DELAY_MS,
        );
        return false;
      }
    } catch {
      // Fall through and attempt to start; downstream flows will surface errors.
    }
    return true;
  }, [triggerPermissionNotification]);

  // Mirrors the original handlePermissionOutcome denial tail: re-check mic
  // permission and surface either the dedicated permission notification or
  // a generic toast. Invoked by usePttGestures whenever a start attempt is
  // actually denied (not merely superseded by a later key-up).
  const handleMicPermissionDenied = useCallback(async () => {
    try {
      const mic = await window.electron?.checkMicrophonePermission?.();
      if (mic && mic.granted === false) {
        triggerPermissionNotification(
          "ptt",
          PERMISSION_NOTIFICATION_INTERACTION_DELAY_MS,
        );
      } else {
        window.notifications?.send?.("Microphone access needed");
      }
    } catch {}
  }, [triggerPermissionNotification]);

  // Only open mic during dictation
  const trans = useTranscription({
    autoInitStream: false,
  });
  // Width for notification (measured offscreen)
  const [notifWidth, setNotifWidth] = useState<number | null>(null);
  const [isTextTruncated, setIsTextTruncated] = useState(false);
  const ghostRef = useRef<HTMLSpanElement | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [pendingHideAfterCollapse, setPendingHideAfterCollapse] = useState<{
    active: boolean;
    message: string;
    onAfter?: () => void;
    deferNotification?: boolean;
  }>({ active: false, message: "" });

  const pushTrace = useCallback((msg: string) => {
    if (!showDebug) return;
    setTrace((t) => [
      `${performance.now().toFixed(0)}: ${msg}`,
      ...t.slice(0, 15),
    ]);
  }, [showDebug]);

  // Listen for active display updates from main (provides computed scale and stored notch width)
  useEffect(() => {
    if (typeof window.onActiveDisplay !== "function") return;
    const unsubscribe = window.onActiveDisplay((payload) => {
      const s = typeof payload?.scale === "number" ? payload.scale : 1;
      setUiScale(s);

      // Use stored notch width if available (calculated once on first launch)
      const storedWidth = payload?.storedNotchWidth;
      const nextNotchWidth =
        storedWidth && storedWidth > 0 ? storedWidth : null;
      setNotchWidth(nextNotchWidth);
    });
    return unsubscribe;
  }, []);

  const {
    state: pillState,
    context: pillContext,
    dispatch: pillDispatch,
  } = usePillMachine();

  useEffect(() => {
    missingCountRef.current = missingPermissions.length;
    const previousSignature = missingSignatureRef.current;
    const nextSignature = missingPermissions.slice().sort().join("|");
    missingSignatureRef.current = nextSignature;

    const prevCount = lastMissingCountRef.current;
    const currentCount = missingPermissions.length;

    if (currentCount > 0) {
      if (panelView !== "permissions") {
        setPanelView("permissions");
      }
      if (prevCount === 0) {
        logPermissionsDebug("missing:detected", missingPermissions);
        triggerPermissionNotification("detected");
      } else if (nextSignature !== previousSignature) {
        logPermissionsDebug("missing:changed", missingPermissions);
        triggerPermissionNotification("changed");
      } else if (!isNotificationScheduled()) {
        schedulePermissionNotification(PERMISSION_NOTIFICATION_REPEAT_DELAY_MS);
      }
    } else {
      if (prevCount > 0) {
        logPermissionsDebug("missing:resolved");
        clearPermissionNotificationLoop();
        if (panelView === "permissions") {
          setPanelView("settings");
        }
        if (autoPermissionsRef.current) {
          autoPermissionsRef.current = false;
          setTimeout(() => {
            pillDispatch({ type: "COLLAPSE" });
          }, 240);
        }
      } else {
        clearPermissionNotificationLoop();
      }
    }

    lastMissingCountRef.current = currentCount;
  }, [
    missingPermissions,
    clearPermissionNotificationLoop,
    schedulePermissionNotification,
    triggerPermissionNotification,
    panelView,
    pillDispatch,
  ]);

  useEffect(() => {
    const completed =
      wasProcessingRef.current && !trans.recording && !trans.processing;
    wasProcessingRef.current = trans.processing;
    if (!completed) return;

    pushTrace(
      trans.text
        ? `Transcription complete: "${trans.text}"`
        : `Transcription finished (no text or failed fast)`,
    );
    pillDispatch({ type: "PROCESSING_COMPLETE" });
  }, [pillDispatch, pushTrace, trans.processing, trans.recording, trans.text]);

  useEffect(() => {
    if (trans.error) {
      window.notifications.send(trans.error);
      pushTrace(`Error: ${trans.error}`);
    }
  }, [pushTrace, trans.error, trans.errorId]);

  useEffect(() => {
    const cleanup = window.notifications.on(({ message, actionId }) => {
      pushTrace(
        `Notify: "${message}"${actionId ? ` (action=${actionId})` : ""} `,
      );
      logPermissionsDebug("notification:received", {
        message,
        actionId,
      });
      pillDispatch({ type: "NOTIFY", msg: message, actionId });
    });
    return cleanup;
  }, [pillDispatch, pushTrace]);

  // Listen for window show events to reset pill state when shown from tray menu
  useEffect(() => {
    const handleWindowShow = () => {
      // When window is shown (e.g., from tray menu), ensure pill is in clean state
      if (pillState !== "LISTENING" && pillState !== "PROCESSING") {
        // Clear any pending hide state and reset to IDLE
        setPendingHideAfterCollapse({ active: false, message: "" });
        pillDispatch({ type: "DISMISS_NOTIFICATION" });
      }
    };

    // Listen for window focus events as a proxy for window being shown
    window.addEventListener("focus", handleWindowShow);
    return () => window.removeEventListener("focus", handleWindowShow);
  }, [pillState]);

  // Listen for expand pill requests from main process
  useEffect(() => {
    const handleExpandPill = () => {
      pillDispatch({ type: "EXPAND" });
      // Ensure OS uses our window for cursor during expanded mode
      window.electron?.setClickThrough(false);
      window.electron?.setFocusable?.(true);
      // Focus the window to ensure cursor hover states work immediately
      window.electron?.focusWindow?.();
    };

    const unsubscribe = window.electron?.expandPill?.(handleExpandPill);
    return () => unsubscribe?.();
  }, []);

  // Ensure click-through is properly managed based on pill state
  useEffect(() => {
    if (pillState === "EXPANDED") {
      window.electron?.setClickThrough(false);
      window.electron?.setFocusable?.(true);
      // Focus the window to ensure cursor hover states work immediately
      window.electron?.focusWindow?.();
    }
  }, [pillState]);

  // Handle click outside to collapse when expanded (only works when click-through is disabled)
  useEffect(() => {
    if (pillState !== "EXPANDED") return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const pillElement = document.querySelector(".pill-core");

      // If click is outside the pill core, collapse
      if (pillElement && !pillElement.contains(target)) {
        pillDispatch({ type: "COLLAPSE" });
      }
    };

    // Add listener with a small delay to ensure click-through is disabled first
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
      // Restore original click-through and focusable behavior when collapsing
      window.electron?.setFocusable?.(false);
      window.electron?.setClickThrough(true);
    };
  }, [pillState]);

  // Also listen for a blur-originated collapse request from main
  useEffect(() => {
    if (pillState !== "EXPANDED") return;
    const onMessage = (ev: MessageEvent) => {
      if (ev.data === "collapse-request") {
        pillDispatch({ type: "COLLAPSE" });
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [pillState, pillDispatch]);

  // During onboarding we avoid fighting with onboarding's request to expand the pill.
  // Keep native window stationary here; expansion is driven by renderer UI state.

  // Debug-only: allow ESC to trigger cancel for local verification
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const debug = params.has("debugPill");
    if (!debug) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        trans.cancel();
        pillDispatch({ type: "CANCEL" });
        pushTrace("Debug cancel via Escape");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pillDispatch, pushTrace, trans]);

  // Notification duration for NOTIFICATION, and optional post-notification hide
  useEffect(() => {
    if (pillState === "NOTIFICATION" && pillContext.notifMsg) {
      const shouldHideAfter = pendingHideAfterCollapse.active;
      const onAfter = pendingHideAfterCollapse.onAfter;
      const duration =
        pillContext.notifAction === PERMISSION_NOTIFICATION_ACTION_ID
          ? PERMISSION_NOTIFICATION_DURATION_MS
          : DEFAULT_NOTIFICATION_DURATION_MS;
      const timeout = setTimeout(async () => {
        pillDispatch({ type: "DISMISS_NOTIFICATION" });

        // If we need to hide after notification, add a small delay to ensure
        // pill state machine completes its transition to IDLE cleanly
        if (shouldHideAfter) {
          setTimeout(async () => {
            try {
              await window.electron?.hideFloatingBarIndefinitely?.();
            } catch {}
            // Allow the fade-out in main to complete before showing onboarding
            setTimeout(() => {
              try {
                onAfter && onAfter();
              } catch {}
              setPendingHideAfterCollapse({ active: false, message: "" });
            }, 180);
          }, 100); // let pill reach IDLE state properly before starting fade-out
        }
      }, duration);
      return () => clearTimeout(timeout);
    }
  }, [
    pillState,
    pillContext.notifMsg,
    pillContext.notifAction,
    pendingHideAfterCollapse.active,
    pendingHideAfterCollapse.onAfter,
    pillDispatch,
  ]);

  const handleNotificationAction = useCallback(
    (actionId: string) => {
      pushTrace(`Notification action triggered: ${actionId}`);
      logPermissionsDebug("notification:action-triggered", { actionId });
      switch (actionId) {
        case PERMISSION_NOTIFICATION_ACTION_ID:
          autoPermissionsRef.current = true;
          setPanelView("permissions");
          pillDispatch({ type: "EXPAND" });
          if (missingCountRef.current > 0) {
            schedulePermissionNotification(
              PERMISSION_NOTIFICATION_INTERACTION_DELAY_MS,
            );
          }
          try {
            window.electron?.focusWindow?.();
          } catch {}
          break;
        default:
          logPermissionsDebug("notification:action-unknown", { actionId });
      }
      pillDispatch({ type: "DISMISS_NOTIFICATION" });
    },
    [pillDispatch, pushTrace, schedulePermissionNotification],
  );

  const notifyThenHide = useCallback(
    (message: string, onAfter?: () => void) => {
      try {
        window.notifications?.send?.(message);
      } catch {}
      // Defer actual hide until NOTIFICATION finishes and we return to IDLE
      setPendingHideAfterCollapse({
        active: true,
        message,
        onAfter,
        deferNotification: false,
      });
    },
    [],
  );

  const handleCollapse = useCallback(() => {
    const { active, message, deferNotification } = pendingHideAfterCollapse;
    setPanelView("settings");
    autoPermissionsRef.current = false;
    pillDispatch({ type: "COLLAPSE" });
    if (active && message && deferNotification) {
      setPendingHideAfterCollapse((prev) => ({
        ...prev,
        deferNotification: false,
      }));
      setTimeout(() => {
        try {
          window.notifications?.send?.(message);
        } catch {}
      }, 0);
    }
  }, [pendingHideAfterCollapse, pillDispatch]);

  const handlePillMetrics = useCallback((metrics: PillMetrics) => {
    setDebugInfo(metrics);
  }, []);

  // Handle mouse enter/leave for click-through control
  const handleMouseEnter = useCallback(() => {
    window.electron?.setClickThrough(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    // Don't enable click-through if pill is expanded
    if (pillState !== "EXPANDED") {
      window.electron?.setClickThrough(true);
    }
  }, [pillState]);

  const handleHoverChange = useCallback(
    (h: boolean) => {
      pillDispatch({ type: h ? "HOVER_ENTER" : "HOVER_LEAVE" });
    },
    [pillDispatch],
  );

  const handleExpand = useCallback(() => {
    // Check if paste shortcut was pressed within last 5 seconds
    const pasteTs = lastPasteShortcutTsRef.current;
    const withinWindow = pasteTs && Date.now() - pasteTs < 5000;
    setInitialSettingsTab(withinWindow ? "history" : "settings");
    // Clear the timestamp so subsequent expands don't trigger history
    lastPasteShortcutTsRef.current = null;
    pillDispatch({ type: "EXPAND" });
  }, [pillDispatch]);

  const handleToggleFloatingBar = useCallback(
    async (enabled: boolean) => {
      // Cancel any pending hide if user turns it back on
      if (enabled) {
        const cancelledDeferredHide =
          pendingHideAfterCollapse.active &&
          pendingHideAfterCollapse.deferNotification;

        setPendingHideAfterCollapse({
          active: false,
          message: "",
          deferNotification: false,
        });

        if (cancelledDeferredHide) {
          // Pill never hid; avoid re-triggering smoothShow flicker
          return;
        }
        // Ensure pill is in clean IDLE state when showing the floating bar
        if (pillState !== "LISTENING" && pillState !== "PROCESSING") {
          pillDispatch({ type: "DISMISS_NOTIFICATION" });
        }
        try {
          await window.electron?.showFloatingBar?.();
        } catch {}
        return;
      }

      const message =
        "Floating Bar Hidden. Use the Tray Menu to bring it back.";
      // If expanded, defer notification until collapse to avoid jank
      if (pillState === "EXPANDED") {
        setPendingHideAfterCollapse({
          active: true,
          message,
          deferNotification: true,
        });
        return;
      }
      // If not expanded, show heads-up now and then hide after it settles
      notifyThenHide(message);
    },
    [pendingHideAfterCollapse, pillState, pillDispatch, notifyThenHide],
  );

  // Derived scaled dimensions based on active display scale
  // (MIN/MAX_UI_SCALE shared with main process via constants/display)
  const S = Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, uiScale || 1));
  const notchTarget = notchWidth && notchWidth > 0 ? notchWidth : null;
  const baseWidthTarget = notchTarget ?? TOKENS.PILL_BASE_W;
  const baseWidthScale = notchTarget ? 1 : S;
  const BASE_W = Math.round(baseWidthTarget * baseWidthScale);
  const BASE_H = Math.round(TOKENS.PILL_BASE_H * S);
  const RESTING_H = Math.round(TOKENS.PILL_RESTING_H * S);
  const expandedWidthTarget =
    panelView === "permissions" ? PERMISSIONS_CONTENT_WIDTH : CONTENT_WIDTH;
  const expandedHeightTarget =
    panelView === "permissions"
      ? permissionsPanelMeasured
        ? permissionsPanelContentHeight
        : Math.round(PERMISSIONS_CONTENT_HEIGHT * S)
      : settingsPanelMeasured
        ? settingsPanelContentHeight
        : Math.round(
            (initialSettingsTab === "history"
              ? CONTENT_HEIGHT
              : SETTINGS_CONTENT_HEIGHT) * S,
          );
  const EXPANDED_W = Math.round(expandedWidthTarget * S);
  const EXPANDED_H = Math.round(expandedHeightTarget);
  const MAX_W = Math.round(TOKENS.PILL_MAX_W * S);

  // Stable dims object so a Pill re-render isn't forced by a fresh literal
  // each render (the values only change on scale/notch/panel transitions).
  const dims = useMemo(
    () => ({
      baseW: BASE_W,
      baseH: BASE_H,
      restingH: RESTING_H,
      expandedW: EXPANDED_W,
      expandedH: EXPANDED_H,
      maxW: MAX_W,
    }),
    [BASE_W, BASE_H, RESTING_H, EXPANDED_W, EXPANDED_H, MAX_W],
  );

  // Measure notification width whenever notif message changes
  useLayoutEffect(() => {
    const msg = pillContext.notifMsg ?? "";
    if (!ghostRef.current || !msg) {
      setNotifWidth(null);
      setIsTextTruncated(false);
      return;
    }
    const el = ghostRef.current;
    el.textContent = msg;
    // Force layout
    const rect = el.getBoundingClientRect();
    // Add same horizontal padding used in visible notification-text class (12px left/right)
    const pad = 24; // px total
    const measuredWidth = Math.ceil(rect.width + pad);
    // Clamp to maximum width to prevent overly wide notifications
    const clampedWidth = Math.min(measuredWidth, MAX_W);
    // Check if text will be truncated
    const isTruncated = measuredWidth > MAX_W;

    setNotifWidth(clampedWidth);
    setIsTextTruncated(isTruncated);
  }, [pillContext.notifMsg, MAX_W]);

  usePttGestures({
    trans,
    pillDispatch,
    canProceedWithStart,
    onMicPermissionDenied: handleMicPermissionDenied,
    pushTrace,
  });

  return (
    <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
      <Pill
        pillState={pillState}
        pillContext={pillContext}
        notifWidth={notifWidth}
        isTextTruncated={isTextTruncated}
        dims={dims}
        onHoverChange={handleHoverChange}
        onMetrics={showDebug ? handlePillMetrics : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onExpand={handleExpand}
        onCollapse={handleCollapse}
        onToggleFloatingBar={handleToggleFloatingBar}
        onNotificationAction={handleNotificationAction}
        panelView={panelView}
        initialSettingsTab={initialSettingsTab}
        onSettingsPanelHeightChange={handleSettingsPanelHeight}
        onPermissionsPanelHeightChange={handlePermissionsPanelHeight}
      />
      <span
        id="pill-ghost-measure"
        className="notification-text fixed left-[-9999px] top-[-9999px] pointer-events-none whitespace-nowrap"
        ref={ghostRef}
      />
      {showDebug && debugInfo && (
        <div
          className="debug-hud"
          style={{
            position: "fixed",
            top: "50px",
            left: "10px",
            background: "rgba(0,0,0,0.7)",
            color: "white",
            padding: "8px",
            borderRadius: "4px",
            fontSize: "12px",
            fontFamily: "monospace",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          <p>
            Pill Rect: W: {debugInfo.pillRect?.width.toFixed(2)} H:{" "}
            {debugInfo.pillRect?.height.toFixed(2)}
          </p>
          <p>
            Notif Length: {debugInfo.notificationText?.length ?? "N/A"} chars
          </p>
          <p>Device Pixel Ratio: {debugInfo.devicePixelRatio}</p>
          <div style={{ marginTop: "10px", borderTop: "1px solid white" }}>
            <p>Trace (last 15 events):</p>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {trace.map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ul>
          </div>
          <p>Pill State: {pillState}</p>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => (
  <PermissionsProvider>
    <AppInner />
  </PermissionsProvider>
);

export default App;
