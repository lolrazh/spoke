import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import Pill from "./Pill";
import { useTranscription } from "../hooks/useTranscription";
import {
  CONTENT_WIDTH,
  CONTENT_HEIGHT,
  PERMISSIONS_CONTENT_WIDTH,
  PERMISSIONS_CONTENT_HEIGHT,
} from "../constants/window";
import { TOKENS } from "../config/uiTokens";
import { playToggleOn } from "../utils/audioFeedback";
import {
  PermissionsProvider,
  usePermissionsController,
} from "../state/permissionsContext";
import { initTranscriptionHistory } from "../state/transcriptionHistory";
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

const leadingThrottle = <T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
) => {
  let timeoutId: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId == null) {
      fn(...args);
      timeoutId = setTimeout(() => {
        timeoutId = null;
      }, delay);
    }
    // Ignore subsequent calls while throttled - do NOT reset the timeout
  };
};

const AppInner: React.FC = () => {
  if (!appRenderMarked) {
    appRenderMarked = true;
    window.electron?.bootMark?.("app-render");
  }
  const [debugInfo, setDebugInfo] = useState<PillMetrics | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [uiScale, setUiScale] = useState(1);
  const [notchWidth, setNotchWidth] = useState<number | null>(null);
  const [settingsPanelMeasured, setSettingsPanelMeasured] = useState(false);
  const [settingsPanelContentHeight, setSettingsPanelContentHeight] =
    useState(CONTENT_HEIGHT);
  const [permissionsPanelMeasured, setPermissionsPanelMeasured] =
    useState(false);
  const [permissionsPanelContentHeight, setPermissionsPanelContentHeight] =
    useState(PERMISSIONS_CONTENT_HEIGHT);
  const { missingPermissions } = usePermissionsController();
  const [panelView, setPanelView] = useState<"settings" | "permissions">(
    "settings",
  );
  const autoPermissionsRef = useRef(false);
  const lastMissingCountRef = useRef<number>(missingPermissions.length);

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
      if (!settingsPanelMeasured) setSettingsPanelMeasured(true);
      setSettingsPanelContentHeight((prev) =>
        prev === normalized ? prev : normalized,
      );
    },
    [settingsPanelMeasured],
  );

  const handlePermissionsPanelHeight = useCallback(
    (height: number) => {
      if (!Number.isFinite(height) || height <= 0) return;
      const normalized = Math.round(height);
      if (!permissionsPanelMeasured) setPermissionsPanelMeasured(true);
      setPermissionsPanelContentHeight((prev) =>
        prev === normalized ? prev : normalized,
      );
    },
    [permissionsPanelMeasured],
  );

  // Initialize always-on client state on app start
  useEffect(() => {
    window.electron?.bootMark?.("app-effect:init-history");
    initTranscriptionHistory().catch(() => {
      // Ignore initialization errors; app can function without history
    });
  }, []);

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

  // Only open mic during dictation
  const trans = useTranscription({
    autoEnumerateDevices: true,
    autoInitStream: false,
    requestLabelPermissionForEnumeration: false,
  });
  // Width for notification (measured offscreen)
  const [notifWidth, setNotifWidth] = useState<number | null>(null);
  const [isTextTruncated, setIsTextTruncated] = useState(false);
  const ghostRef = useRef<HTMLSpanElement | null>(null);
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Double-tap detection for hands-free (Right Option)
  const lastTapUpRef = useRef<number | null>(null);
  const doubleTapTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);
  const isOptionDownRef = useRef(false);
  const gestureTokenCounterRef = useRef(0);
  const pendingStartTokenRef = useRef<{
    id: number;
    kind: "hold" | "doubleTap";
  } | null>(null);
  const holdActivationNonceRef = useRef<number | null>(null);
  // Prevent double-playing the start cue when long-press timer and
  // double-tap start race on first gesture after idle
  const startCuePlayedRef = useRef(false);
  const latestTransRef = useRef(trans);
  const [trace, setTrace] = useState<string[]>([]);
  const [pendingHideAfterCollapse, setPendingHideAfterCollapse] = useState<{
    active: boolean;
    message: string;
    onAfter?: () => void;
    deferNotification?: boolean;
  }>({ active: false, message: "" });

  const permissionCheckNonceRef = useRef(0);
  const permissionCheckStateRef = useRef<{
    token: number | null;
    result: boolean | null;
  }>({ token: null, result: null });
  const permissionCheckPromiseRef = useRef<Promise<boolean> | null>(null);
  const activeCaptureRef = useRef<{
    token: number;
    kind: "hold" | "doubleTap";
  } | null>(null);
  const postStartActionRef = useRef<Map<number, "cancel" | "stop">>(new Map());
  const prevRecordingRef = useRef(trans.recording);

  const beginPermissionCheck = useCallback(() => {
    const nextToken = permissionCheckNonceRef.current + 1;
    permissionCheckNonceRef.current = nextToken;
    permissionCheckStateRef.current = { token: nextToken, result: null };
    const promise = canProceedWithStart();
    permissionCheckPromiseRef.current = promise;
    promise
      .then((allowed) => {
        if (permissionCheckStateRef.current.token === nextToken) {
          permissionCheckStateRef.current = {
            token: nextToken,
            result: allowed,
          };
        }
        return allowed;
      })
      .catch(() => {
        if (permissionCheckStateRef.current.token === nextToken) {
          permissionCheckStateRef.current = { token: nextToken, result: null };
        }
      });
    return { token: nextToken, promise };
  }, [canProceedWithStart]);

  const pushTrace = useCallback((msg: string) => {
    setTrace((t) => [
      `${performance.now().toFixed(0)}: ${msg}`,
      ...t.slice(0, 15),
    ]);
  }, []);

  useEffect(() => {
    pushTrace(`Mode: ${trans.mode}`);
  }, [trans.mode, pushTrace]);

  useEffect(() => {
    if (!trans.selection) return;
    const snapshot = trans.selection;
    const summary = snapshot.hadSelection
      ? `Selection captured (${snapshot.selectedText?.length ?? 0} chars)`
      : `Selection inspect ${snapshot.status}`;
    pushTrace(summary);
  }, [trans.selection, pushTrace]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowDebug(params.has("debugPill"));
  }, []);

  useEffect(() => {
    latestTransRef.current = trans;
  }, [trans]);

  // Listen for active display updates from main (provides computed scale and stored notch width)
  useEffect(() => {
    if (typeof window.onActiveDisplay !== "function") return;
    window.onActiveDisplay?.((payload) => {
      const s = typeof payload?.scale === "number" ? payload.scale : 1;
      setUiScale(s);

      // Use stored notch width if available (calculated once on first launch)
      const storedWidth = payload?.storedNotchWidth;
      const nextNotchWidth =
        storedWidth && storedWidth > 0 ? storedWidth : null;
      setNotchWidth(nextNotchWidth);

      // Display info updated (removed noisy logging)
    });
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

  const beginCaptureSession = useCallback(
    (token: number, kind: "hold" | "doubleTap") => {
      activeCaptureRef.current = { token, kind };
      postStartActionRef.current.delete(token);
      pushTrace(`Capture session begin (${kind}) token=${token}`);
    },
    [pushTrace],
  );

  const schedulePostStartAction = useCallback(
    (token: number, action: "cancel" | "stop") => {
      postStartActionRef.current.set(token, action);
      pushTrace(`Scheduled post-start ${action} for token=${token}`);
    },
    [pushTrace],
  );

  const clearActiveCapture = useCallback(
    (token?: number) => {
      if (typeof token === "number") {
        postStartActionRef.current.delete(token);
        if (activeCaptureRef.current?.token === token) {
          pushTrace(
            `Capture session cleared (${activeCaptureRef.current.kind}) token=${token}`,
          );
          activeCaptureRef.current = null;
        }
        return;
      }
      if (activeCaptureRef.current) {
        pushTrace(
          `Capture session cleared (${activeCaptureRef.current.kind}) token=${activeCaptureRef.current.token}`,
        );
      }
      activeCaptureRef.current = null;
      postStartActionRef.current.clear();
    },
    [pushTrace],
  );

  const monitorStartResolution = useCallback(
    (token: number, kind: "hold" | "doubleTap", promise: Promise<unknown>) => {
      promise
        .then(() => {
          const scheduled = postStartActionRef.current.get(token);
          if (!scheduled) return;
          pushTrace(
            `Start resolved; executing scheduled ${scheduled} for ${kind} token=${token}`,
          );
          if (scheduled === "cancel") {
            try {
              latestTransRef.current.cancel();
            } catch {}
            pillDispatch({ type: "CANCEL" });
          } else {
            try {
              latestTransRef.current.stop();
            } catch {}
            pillDispatch({ type: "PTT_STOP" });
          }
          clearActiveCapture(token);
        })
        .catch((err) => {
          pushTrace(
            `Start failed for ${kind} token=${token}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          clearActiveCapture(token);
        })
        .finally(() => {
          postStartActionRef.current.delete(token);
        });
    },
    [
      clearActiveCapture,
      pillDispatch,
      pushTrace,
      triggerPermissionNotification,
    ],
  );

  useEffect(() => {
    const wasRecording = prevRecordingRef.current;
    if (!wasRecording && trans.recording) {
      const active = activeCaptureRef.current;
      const postAction = active
        ? postStartActionRef.current.get(active.token)
        : undefined;
      if (active && postAction) {
        pushTrace(
          `Start pending scheduled ${postAction} for ${active.kind} token=${active.token}`,
        );
      } else if (active && active.kind === "hold" && !isOptionDownRef.current) {
        pushTrace("Auto-cancel hold capture after late start");
        try {
          latestTransRef.current.cancel();
        } catch {}
        pillDispatch({ type: "CANCEL" });
        clearActiveCapture(active.token);
      }
    }
    prevRecordingRef.current = trans.recording;
  }, [clearActiveCapture, pillDispatch, pushTrace, trans.recording]);

  const snapshotPermissionGuard = useCallback(
    (refresh = false) => {
      if (refresh) {
        const { token, promise } = beginPermissionCheck();
        return {
          permissionToken: token,
          permissionResult: permissionCheckStateRef.current.result,
          permissionPromise: promise,
        };
      }
      let { token: permissionToken, result: permissionResult } =
        permissionCheckStateRef.current;
      let permissionPromise = permissionCheckPromiseRef.current;
      if (permissionToken == null) {
        const { token, promise } = beginPermissionCheck();
        permissionToken = token;
        permissionResult = permissionCheckStateRef.current.result;
        permissionPromise = promise;
      }
      return { permissionToken, permissionResult, permissionPromise };
    },
    [beginPermissionCheck],
  );

  const handlePermissionOutcome = useCallback(
    async (
      allowed: boolean,
      tokenId: number,
      kind: "hold" | "doubleTap",
      permissionToken: number | null,
    ) => {
      const pendingToken = pendingStartTokenRef.current;
      if (
        !pendingToken ||
        pendingToken.id !== tokenId ||
        pendingToken.kind !== kind
      ) {
        return;
      }
      if (
        permissionToken != null &&
        permissionCheckStateRef.current.token !== permissionToken
      ) {
        return;
      }
      if (!allowed) {
        pendingStartTokenRef.current = null;
        if (kind === "hold") {
          isLongPressRef.current = false;
        }
        try {
          latestTransRef.current.cancel();
        } catch {}
        pushTrace(`PTT ${kind} gate denied`);
        pillDispatch({ type: "CANCEL" });
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
        clearActiveCapture(tokenId);
        return;
      }
      pendingStartTokenRef.current = null;
      pushTrace(`PTT ${kind} capture started`);
    },
    [clearActiveCapture, pillDispatch, pushTrace],
  );

  const attachPermissionPromise = useCallback(
    (
      permissionPromise: Promise<boolean> | null | undefined,
      tokenId: number,
      kind: "hold" | "doubleTap",
      permissionToken: number | null,
    ) => {
      if (!permissionPromise) {
        void handlePermissionOutcome(true, tokenId, kind, permissionToken);
        return;
      }
      permissionPromise
        .then((allowed) =>
          handlePermissionOutcome(allowed, tokenId, kind, permissionToken),
        )
        .catch(() =>
          handlePermissionOutcome(true, tokenId, kind, permissionToken),
        );
    },
    [handlePermissionOutcome],
  );

  useEffect(() => {
    if (!trans.recording && !trans.processing) {
      pushTrace(
        trans.text
          ? `Transcription complete: "${trans.text}"`
          : `Transcription finished (no text or failed fast)`,
      );
      pillDispatch({ type: "PROCESSING_COMPLETE" });
    }
  }, [pillDispatch, pushTrace, trans.processing, trans.recording, trans.text]);

  useEffect(() => {
    if (trans.error) {
      window.notifications.send(trans.error);
      pushTrace(`Error: ${trans.error}`);
    }
  }, [pushTrace, trans.error]);

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
        pillDispatch({ type: "ANIM_DONE" }); // Reset to IDLE state
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

    window.electron?.expandPill?.(handleExpandPill);

    // Note: No cleanup needed as this is a one-time setup
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

  // Subscribe to a global cancel signal (Right Command via native helper; wired later)
  useEffect(() => {
    const onCancel = () => {
      // Treat cancel as concluding the current PTT gesture: prevent pending long-press start
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
      // Clear double-tap detection state to allow immediate re-activation
      if (doubleTapTimerRef.current) {
        clearTimeout(doubleTapTimerRef.current);
        doubleTapTimerRef.current = null;
      }
      lastTapUpRef.current = null;
      // Force the key-up handler to take the long-press branch (which is a no-op when not recording)
      isLongPressRef.current = true;
      // If we're recording, perform a true cancel and snap UI back to IDLE
      if (latestTransRef.current.recording) {
        latestTransRef.current.cancel();
        pillDispatch({ type: "CANCEL" });
        pushTrace("PTT cancel (recording)");
        return;
      }
      // If processing, just snap UI back to IDLE (Milestone 2 may add abort)
      if (latestTransRef.current.processing) {
        // Abort in-flight network if any, then snap to IDLE
        latestTransRef.current.cancel();
        pillDispatch({ type: "CANCEL" });
        pushTrace("PTT cancel (processing)");
      }
    };
    const cleanup = window.ptt?.onCancel
      ? window.ptt.onCancel(onCancel)
      : undefined;
    return () => {
      if (cleanup) cleanup();
    };
  }, [pillDispatch, pushTrace]);

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
        pillDispatch({ type: "ANIM_DONE" });

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
      pillDispatch({ type: "ANIM_DONE" });
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

  // NOTE: Keep clamp consistent with main process scaling
  const MIN_UI_SCALE = 0.9;
  const MAX_UI_SCALE = 1.0;
  // Derived scaled dimensions based on active display scale
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
        : Math.round(CONTENT_HEIGHT * S);
  const EXPANDED_W = Math.round(expandedWidthTarget * S);
  const EXPANDED_H = Math.round(expandedHeightTarget);
  const MAX_W = Math.round(TOKENS.PILL_MAX_W * S);

  useEffect(() => {
    // Pill width computed from notch (removed noisy logging)
  }, [BASE_W, S, notchTarget]);

  // Measure notification width whenever notif message changes
  useLayoutEffect(() => {
    if (!ghostRef.current) return;
    const el = ghostRef.current;
    const msg = pillContext.notifMsg ?? "";
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

  useEffect(() => {
    if (!window.ptt?.onDown || !window.ptt?.onUp) return;

    const HOLD_DURATION_MS = 130; // slightly longer to avoid interfering with slow double-taps

    const handleFunctionKeyDown = () => {
      pushTrace(`PTT down`);
      if (isOptionDownRef.current) {
        pushTrace(`PTT down ignored (already active)`);
        return;
      }
      isOptionDownRef.current = true;
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      startCuePlayedRef.current = false;
      if (latestTransRef.current.processing) {
        if (window.notifications?.send) {
          window.notifications.send("Still transcribing… wait a sec");
        }
        isOptionDownRef.current = false;
        return;
      }
      if (latestTransRef.current.recording) {
        return;
      }
      isLongPressRef.current = false;
      beginPermissionCheck();
      const holdNonce = ++gestureTokenCounterRef.current;
      holdActivationNonceRef.current = holdNonce;
      pressTimerRef.current = setTimeout(() => {
        if (holdActivationNonceRef.current !== holdNonce) {
          pushTrace(`PTT long press timer stale`);
          return;
        }
        if (!isOptionDownRef.current) {
          pushTrace(`PTT long press timer fired but key not down`);
          return;
        }
        isLongPressRef.current = true;
        holdActivationNonceRef.current = null;
        if (!startCuePlayedRef.current) {
          try {
            playToggleOn();
          } catch {}
          startCuePlayedRef.current = true;
        }
        if (doubleTapTimerRef.current) {
          clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = null;
        }
        lastTapUpRef.current = null;
        const { permissionToken, permissionResult, permissionPromise } =
          snapshotPermissionGuard();
        pushTrace(`PTT long press start (pending gate)`);
        pillDispatch({ type: "PTT_START" });
        const tokenId = ++gestureTokenCounterRef.current;
        pendingStartTokenRef.current = { id: tokenId, kind: "hold" };
        beginCaptureSession(tokenId, "hold");
        if (permissionResult === false) {
          void handlePermissionOutcome(false, tokenId, "hold", permissionToken);
          return;
        }
        if (!isOptionDownRef.current) {
          pendingStartTokenRef.current = null;
          isLongPressRef.current = false;
          pushTrace(`PTT long press gate aborted (key lifted)`);
          pillDispatch({ type: "CANCEL" });
          clearActiveCapture(tokenId);
          return;
        }
        let startResult: void | Promise<void>;
        try {
          startResult = latestTransRef.current.start();
        } catch (err) {
          pushTrace(
            `PTT hold start failed synchronously: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          clearActiveCapture(tokenId);
          pillDispatch({ type: "CANCEL" });
          return;
        }
        monitorStartResolution(tokenId, "hold", Promise.resolve(startResult));
        if (permissionResult === true) {
          void handlePermissionOutcome(true, tokenId, "hold", permissionToken);
          return;
        }
        pushTrace(`PTT long press capture pending gate`);
        attachPermissionPromise(
          permissionPromise,
          tokenId,
          "hold",
          permissionToken,
        );
      }, HOLD_DURATION_MS);
    };

    const handleFunctionKeyUp = () => {
      pushTrace(`PTT up`);
      if (!isOptionDownRef.current) {
        pushTrace(`PTT up ignored (no active press)`);
        lastTapUpRef.current = null;
        if (doubleTapTimerRef.current) {
          clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = null;
        }
        return;
      }
      isOptionDownRef.current = false;
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
      holdActivationNonceRef.current = null;
      if (
        pendingStartTokenRef.current?.kind === "hold" &&
        !latestTransRef.current.recording
      ) {
        pendingStartTokenRef.current = null;
      }
      if (isLongPressRef.current) {
        const activeHold =
          activeCaptureRef.current?.kind === "hold"
            ? activeCaptureRef.current
            : null;
        if (latestTransRef.current.recording) {
          pendingStartTokenRef.current = null;
          latestTransRef.current.stop();
          pushTrace(`PTT long press stop`);
          pillDispatch({ type: "PTT_STOP" });
          if (activeHold) {
            clearActiveCapture(activeHold.token);
          }
        } else {
          pendingStartTokenRef.current = null;
          if (activeHold) {
            schedulePostStartAction(activeHold.token, "cancel");
          }
          pushTrace(`PTT long press canceled before start`);
          pillDispatch({ type: "CANCEL" });
        }
      } else {
        const now = Date.now();
        const DOUBLE_MS = 450; // more forgiving window for double-taps to avoid PTT interference
        if (lastTapUpRef.current && now - lastTapUpRef.current <= DOUBLE_MS) {
          if (doubleTapTimerRef.current) {
            clearTimeout(doubleTapTimerRef.current);
            doubleTapTimerRef.current = null;
          }
          // Check both pendingStartTokenRef AND activeCaptureRef because:
          // - pendingStartTokenRef gets cleared early by handlePermissionOutcome
          // - activeCaptureRef persists until the capture session actually completes
          // This prevents the race where second tap starts NEW recording instead of stopping
          const pendingTokenId =
            pendingStartTokenRef.current?.id ??
            activeCaptureRef.current?.token ??
            null;
          const pendingHandsFree =
            pendingStartTokenRef.current?.kind === "doubleTap" ||
            activeCaptureRef.current?.kind === "doubleTap";
          lastTapUpRef.current = null;
          if (latestTransRef.current.recording) {
            pendingStartTokenRef.current = null;
            latestTransRef.current.stop();
            pushTrace(`PTT double-tap stop`);
            pillDispatch({ type: "PTT_STOP" });
            if (activeCaptureRef.current?.kind === "doubleTap") {
              clearActiveCapture(activeCaptureRef.current.token);
            }
          } else if (pendingHandsFree) {
            pendingStartTokenRef.current = null;
            pushTrace(`PTT double-tap start canceled before activation`);
            try {
              latestTransRef.current.cancel();
            } catch {}
            pillDispatch({ type: "CANCEL" });
            if (pendingTokenId != null) {
              clearActiveCapture(pendingTokenId);
            }
          } else {
            const { permissionToken, permissionResult, permissionPromise } =
              snapshotPermissionGuard();
            const tokenId = ++gestureTokenCounterRef.current;
            pendingStartTokenRef.current = { id: tokenId, kind: "doubleTap" };
            beginCaptureSession(tokenId, "doubleTap");
            if (!startCuePlayedRef.current) {
              try {
                playToggleOn();
              } catch {}
              startCuePlayedRef.current = true;
            }
            pillDispatch({ type: "PTT_START" });
            pushTrace(`PTT double-tap start (pending gate)`);
            if (permissionResult === false) {
              void handlePermissionOutcome(
                false,
                tokenId,
                "doubleTap",
                permissionToken,
              );
              return;
            }
            let startResult: void | Promise<void>;
            try {
              startResult = latestTransRef.current.start();
            } catch (err) {
              pushTrace(
                `PTT double-tap start failed synchronously: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
              clearActiveCapture(tokenId);
              pillDispatch({ type: "CANCEL" });
              return;
            }
            monitorStartResolution(
              tokenId,
              "doubleTap",
              Promise.resolve(startResult),
            );
            if (permissionResult === true) {
              void handlePermissionOutcome(
                true,
                tokenId,
                "doubleTap",
                permissionToken,
              );
              return;
            }
            pushTrace(`PTT double-tap capture pending gate`);
            attachPermissionPromise(
              permissionPromise,
              tokenId,
              "doubleTap",
              permissionToken,
            );
          }
        } else {
          lastTapUpRef.current = now;
          if (doubleTapTimerRef.current)
            clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = setTimeout(() => {
            lastTapUpRef.current = null;
            doubleTapTimerRef.current = null;
          }, DOUBLE_MS);
        }
      }
      isLongPressRef.current = false;
    };

    const throttledKeyDown = leadingThrottle(handleFunctionKeyDown, 25);
    const throttledKeyUp = leadingThrottle(handleFunctionKeyUp, 25);
    const cleanupOnDown = window.ptt.onDown(throttledKeyDown);
    const cleanupOnUp = window.ptt.onUp(throttledKeyUp);

    return () => {
      cleanupOnDown();
      cleanupOnUp();
      if (doubleTapTimerRef.current) {
        clearTimeout(doubleTapTimerRef.current);
        doubleTapTimerRef.current = null;
      }
    };
  }, [
    attachPermissionPromise,
    beginPermissionCheck,
    clearActiveCapture,
    handlePermissionOutcome,
    monitorStartResolution,
    pushTrace,
    schedulePostStartAction,
    snapshotPermissionGuard,
  ]);

  return (
    <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
      <Pill
        pillState={pillState}
        pillContext={pillContext}
        notifWidth={notifWidth}
        isTextTruncated={isTextTruncated}
        audioLevel={trans.audioLevel}
        dims={{
          baseW: BASE_W,
          baseH: BASE_H,
          restingH: RESTING_H,
          expandedW: EXPANDED_W,
          expandedH: EXPANDED_H,
          maxW: MAX_W,
        }}
        onHoverChange={(h) =>
          pillDispatch({ type: h ? "HOVER_ENTER" : "HOVER_LEAVE" })
        }
        onMetrics={handlePillMetrics}
        onAnimDone={() => pillDispatch({ type: "ANIM_DONE" })}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onExpand={() => {
          // Check if paste shortcut was pressed within last 5 seconds
          const pasteTs = lastPasteShortcutTsRef.current;
          const withinWindow = pasteTs && Date.now() - pasteTs < 5000;
          setInitialSettingsTab(withinWindow ? "history" : "settings");
          // Clear the timestamp so subsequent expands don't trigger history
          lastPasteShortcutTsRef.current = null;
          pillDispatch({ type: "EXPAND" });
        }}
        onCollapse={handleCollapse}
        onToggleFloatingBar={async (enabled: boolean) => {
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
              pillDispatch({ type: "ANIM_DONE" }); // Reset to IDLE state
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
        }}
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
