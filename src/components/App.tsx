import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useReducer,
  useLayoutEffect,
} from "react";
import Pill from "./Pill";
import { useTranscription } from "../hooks/useTranscription";
import { CONTENT_WIDTH, CONTENT_HEIGHT } from "../constants/window";
import { TOKENS } from "../config/uiTokens";
import { playToggleOn } from "../utils/audioFeedback";

// Pill State Machine Types
export type PillStateType =
  | "IDLE"
  | "LISTENING"
  | "PROCESSING"
  | "NOTIFICATION"
  | "HOVER_PREVIEW"
  | "EXPANDED";

export type PillEvent =
  | { type: "PTT_START" }
  | { type: "PTT_STOP" }
  | { type: "CANCEL" }
  | { type: "NOTIFY"; msg: string }
  | { type: "ANIM_DONE" }
  | { type: "HOVER_ENTER" }
  | { type: "HOVER_LEAVE" }
  | { type: "PROCESSING_COMPLETE" }
  | { type: "EXPAND" }
  | { type: "COLLAPSE" };

export interface PillMachineState {
  state: PillStateType;
  context: {
    pendingNotif?: string;
    notifMsg?: string;
  };
}

// Reducer function for pill machine
const pillReducer = (
  state: PillMachineState,
  event: PillEvent,
): PillMachineState => {
  switch (state.state) {
    case "IDLE":
      if (event.type === "PTT_START") return { ...state, state: "LISTENING" };
      if (event.type === "NOTIFY")
        return {
          state: "NOTIFICATION",
          context: { ...state.context, notifMsg: event.msg },
        };
      if (event.type === "HOVER_ENTER")
        return { ...state, state: "HOVER_PREVIEW" };
      if (event.type === "EXPAND") return { ...state, state: "EXPANDED" };
      return state;
    case "LISTENING":
      if (event.type === "PTT_STOP") return { ...state, state: "PROCESSING" };
      if (event.type === "CANCEL") return { ...state, state: "IDLE" };
      if (event.type === "NOTIFY")
        return {
          ...state,
          context: { ...state.context, pendingNotif: event.msg },
        };
      return state;
    case "PROCESSING":
      if (event.type === "CANCEL") return { ...state, state: "IDLE" };
      if (event.type === "PROCESSING_COMPLETE") {
        if (state.context.pendingNotif) {
          return {
            state: "NOTIFICATION",
            context: {
              notifMsg: state.context.pendingNotif,
              pendingNotif: undefined,
            },
          };
        }
        return { ...state, state: "IDLE" };
      }
      return state;
    case "NOTIFICATION":
      if (event.type === "PTT_START")
        return {
          state: "LISTENING",
          context: { ...state.context, pendingNotif: state.context.notifMsg },
        };
      if (event.type === "ANIM_DONE")
        return {
          ...state,
          state: "IDLE",
          context: { ...state.context, notifMsg: undefined },
        };
      return state;
    case "HOVER_PREVIEW":
      if (event.type === "HOVER_LEAVE") return { ...state, state: "IDLE" };
      if (event.type === "PTT_START") return { ...state, state: "LISTENING" };
      if (event.type === "EXPAND") return { ...state, state: "EXPANDED" };
      return state;
    case "EXPANDED":
      if (event.type === "COLLAPSE") return { ...state, state: "IDLE" };
      if (event.type === "PTT_START") return { ...state, state: "LISTENING" };
      return state;
    default:
      return state;
  }
};

// Simple fixed notification duration
const NOTIFICATION_DURATION_MS = 2000;

type PillMetrics = {
  pillRect: DOMRect | null;
  notificationText: string | null;
  devicePixelRatio: number;
};

const usePillMachine = () => {
  const [machine, dispatch] = useReducer(
    (state: PillMachineState, event: PillEvent) => {
      console.log(`[Reducer] Dispatching ${event.type}`);
      return pillReducer(state, event);
    },
    { state: "IDLE", context: {} },
  );
  return { state: machine.state, context: machine.context, dispatch };
};

const debounce = <T extends (...args: unknown[]) => void>(
  func: T,
  delay: number,
) => {
  let timeoutId: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
};

// Centralized dictation gate: require auth (unless dev skip) and mic permission.
// Returns true if dictation may proceed, else notifies and returns false.
const canProceedWithStartBasedOnMicPermission = async (): Promise<boolean> => {
  try {
    const skipAuth = !!window.devFlags?.skipAuth;
    if (!skipAuth) {
      try {
        const { getCurrentUser } = await import("../lib/supabaseClient");
        const user = await getCurrentUser();
        if (!user) {
          try {
            window.notifications?.send?.("Sign in to dictate");
          } catch {}
          try {
            await window.electron?.showOnboarding?.();
          } catch {}
          return false;
        }
      } catch {}
    }
    const mic = await window.electron?.checkMicrophonePermission?.();
    if (!mic?.granted) {
      window.notifications?.send?.(
        "Microphone permission is off. Double-click to open Settings.",
      );
      return false;
    }
  } catch {
    // Fall through and attempt to start; useTranscription will surface errors
  }
  return true;
};

const App: React.FC = () => {
  const [debugInfo, setDebugInfo] = useState<PillMetrics | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [uiScale, setUiScale] = useState(1);
  // Ensure pill is not shown when signed out; route to onboarding instead
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let pollId: number | undefined;
    (async () => {
      try {
        const { getSupabase, getCurrentUser } = await import(
          "../lib/supabaseClient"
        );
        const skipAuth = !!window.devFlags?.skipAuth;
        const user = skipAuth ? { id: "dev" } : await getCurrentUser();
        if (!user && !skipAuth) {
          try {
            await window.electron?.showOnboarding?.();
          } catch {}
          try {
            await window.electron?.hideFloatingBarIndefinitely?.();
          } catch {}
          try {
            // Stop any active capture if present
            latestTransRef.current?.cancel?.();
          } catch {}
        }
        const supabase = getSupabase();
        if (supabase) {
          const {
            data: { subscription },
          } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session?.user && !skipAuth) {
              (async () => {
                try {
                  // Cancel any active or in-flight transcription when signing out
                  latestTransRef.current?.cancel?.();
                } catch {}
                try {
                  await window.electron?.showOnboarding?.();
                } catch {}
                try {
                  await window.electron?.hideFloatingBarIndefinitely?.();
                } catch {}
              })();
            }
          });
          unsubscribe = () => subscription.unsubscribe();

          // Light polling to detect server-side deletions or expired sessions
          try {
            pollId = window.setInterval(async () => {
              if (skipAuth) return;
              try {
                if (!supabase) return; // No client available; skip this tick
                const { data, error } = await supabase.auth.getUser();
                // Only treat as signed-out when there is NO error and NO user
                if (!error && !data?.user) {
                  try { latestTransRef.current?.cancel?.(); } catch {}
                  try { await window.electron?.showOnboarding?.(); } catch {}
                  try { await window.electron?.hideFloatingBarIndefinitely?.(); } catch {}
                }
                // If error: likely network issue — ignore and retain current UX
              } catch {}
            }, 60000);
          } catch {}
        }
      } catch {}
    })();
    return () => {
      if (unsubscribe) unsubscribe();
      if (pollId) clearInterval(pollId);
    };
  }, []);
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
  const latestTransRef = useRef(trans);
  const [trace, setTrace] = useState<string[]>([]);
  const [pendingHideAfterCollapse, setPendingHideAfterCollapse] = useState<{
    active: boolean;
    message: string;
  }>({ active: false, message: "" });

  const pushTrace = (msg: string) => {
    setTrace((t) => [
      `${performance.now().toFixed(0)}: ${msg}`,
      ...t.slice(0, 15),
    ]);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowDebug(params.has("debugPill"));
  }, []);

  useEffect(() => {
    latestTransRef.current = trans;
  }, [trans]);

  // Listen for active display updates from main (provides computed scale)
  useEffect(() => {
    if (typeof window.onActiveDisplay !== "function") return;
    window.onActiveDisplay?.((payload) => {
      const s = typeof payload?.scale === "number" ? payload.scale : 1;
      setUiScale(s);
    });
  }, []);

  const {
    state: pillState,
    context: pillContext,
    dispatch: pillDispatch,
  } = usePillMachine();

  useEffect(() => {
    // Allow onboarding to mirror pill state during test steps
    const offStart = window.electron?.onPillMirrorStart?.(() => {
      pillDispatch({ type: "PTT_START" });
    });
    const offStop = window.electron?.onPillMirrorStop?.(() => {
      pillDispatch({ type: "PTT_STOP" });
    });
    const offComplete = window.electron?.onPillMirrorComplete?.(() => {
      pillDispatch({ type: "PROCESSING_COMPLETE" });
    });
    const offCancel = window.electron?.onPillMirrorCancel?.(() => {
      pillDispatch({ type: "CANCEL" });
    });
    return () => {
      try { offStart && offStart(); } catch {}
      try { offStop && offStop(); } catch {}
      try { offComplete && offComplete(); } catch {}
      try { offCancel && offCancel(); } catch {}
    };
  }, [pillDispatch]);

  useEffect(() => {
    if (!trans.recording && !trans.processing) {
      pushTrace(
        trans.text
          ? `Transcription complete: "${trans.text}"`
          : `Transcription finished (no text or failed fast)`,
      );
      pillDispatch({ type: "PROCESSING_COMPLETE" });
    }
  }, [trans.recording, trans.processing]);

  useEffect(() => {
    if (trans.error) {
      window.notifications.send(trans.error);
      pushTrace(`Error: ${trans.error}`);
    }
  }, [trans.error]);

  useEffect(() => {
    const cleanup = window.notifications.on((message: string) => {
      pushTrace(`Notify: "${message}" `);
      pillDispatch({ type: "NOTIFY", msg: message });
    });
    return cleanup;
  }, []);

  // Lightweight polling for microphone permission to keep UI honest
  useEffect(() => {
    let pollId: number | null = null;
    const startPolling = () => {
      if (pollId != null) return;
      pollId = window.setInterval(async () => {
        try {
          const mic = await window.electron?.checkMicrophonePermission?.();
          if (mic && !mic.granted) {
            // Surface a user-friendly heads-up; pill will show NOTIFICATION state
            window.notifications?.send?.(
              "Microphone permission is off. Double-click to open Settings.",
            );
          }
        } catch {}
      }, 8000);
    };
    const stopPolling = () => {
      if (pollId != null) {
        clearInterval(pollId);
        pollId = null;
      }
    };

    // Start polling when idle (not recording/processing)
    if (!trans.recording && !trans.processing) startPolling();
    else stopPolling();

    return () => stopPolling();
  }, [trans.recording, trans.processing]);

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
  }, [pillDispatch]);

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
  }, [pillDispatch, trans]);

  // Notification duration for NOTIFICATION, and optional post-notification hide
  useEffect(() => {
    if (pillState === "NOTIFICATION" && pillContext.notifMsg) {
      const shouldHideAfter = pendingHideAfterCollapse.active;
      const timeout = setTimeout(async () => {
        pillDispatch({ type: "ANIM_DONE" });

        // If we need to hide after notification, add a small delay to ensure
        // pill state machine completes its transition to IDLE cleanly
        if (shouldHideAfter) {
          setTimeout(async () => {
            try {
              await window.electron?.hideFloatingBarIndefinitely?.();
            } catch {}
            setPendingHideAfterCollapse({ active: false, message: "" });
          }, 100); // 100ms delay to let pill reach IDLE state properly
        }
      }, NOTIFICATION_DURATION_MS);
      return () => clearTimeout(timeout);
    }
  }, [pillState, pillContext.notifMsg, pendingHideAfterCollapse.active]);

  const notifyThenHide = useCallback((message: string) => {
    try {
      window.notifications?.send?.(message);
    } catch {}
    // Defer actual hide until NOTIFICATION finishes and we return to IDLE
    setPendingHideAfterCollapse({ active: true, message });
  }, []);

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
  const BASE_W = Math.round(TOKENS.PILL_BASE_W * S);
  const BASE_H = Math.round(TOKENS.PILL_BASE_H * S);
  const RESTING_H = Math.round(TOKENS.PILL_RESTING_H * S);
  const EXPANDED_W = Math.round(CONTENT_WIDTH * S);
  const EXPANDED_H = Math.round(CONTENT_HEIGHT * S);
  const MAX_W = Math.round(TOKENS.PILL_MAX_W * S);

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

    const HOLD_DURATION_MS = 80;

    const handleFunctionKeyDown = () => {
      pushTrace(`PTT down`);
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      // Add processing guard
      if (latestTransRef.current.processing) {
        if (window.notifications?.send) {
          window.notifications.send("Still transcribing… wait a sec");
        }
        return;
      }
      if (latestTransRef.current.recording) {
        return;
      }
      isLongPressRef.current = false;
      pressTimerRef.current = setTimeout(async () => {
        isLongPressRef.current = true;
        // Play audio on actual long-press start
        try { playToggleOn(); } catch {}
        // Cancel any pending double-tap window
        if (doubleTapTimerRef.current) {
          clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = null;
        }
        lastTapUpRef.current = null;
        pushTrace(`PTT long press start`);
        // Immediate visual drop for responsiveness
        pillDispatch({ type: "PTT_START" });
        // Start capture immediately to minimize perceived latency
        if (!latestTransRef.current.recording) {
          try { latestTransRef.current.start(); } catch {}
        }
        // Run auth/mic checks in the background and cancel if they fail
        (async () => {
          const allowed = await canProceedWithStartBasedOnMicPermission();
          if (!allowed) {
            try {
              const mic = await window.electron?.checkMicrophonePermission?.();
              const msg = mic && mic.granted === false
                ? "Microphone permission is off. Double-click to open Settings."
                : "Sign in to dictate";
              try { latestTransRef.current.cancel(); } catch {}
              pillDispatch({ type: "CANCEL" });
              pillDispatch({ type: "NOTIFY", msg });
            } catch {
              try { latestTransRef.current.cancel(); } catch {}
              pillDispatch({ type: "CANCEL" });
            }
          }
        })();
      }, HOLD_DURATION_MS);
    };

    const handleFunctionKeyUp = () => {
      pushTrace(`PTT up`);
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
      if (isLongPressRef.current) {
        if (latestTransRef.current.recording) {
          latestTransRef.current.stop();
          pushTrace(`PTT long press stop`);
          pillDispatch({ type: "PTT_STOP" });
        }
      } else {
        // Double-tap to toggle hands-free
        const now = Date.now();
        const DOUBLE_MS = 220;
        if (lastTapUpRef.current && now - lastTapUpRef.current <= DOUBLE_MS) {
          // Confirmed double-tap
          if (doubleTapTimerRef.current) {
            clearTimeout(doubleTapTimerRef.current);
            doubleTapTimerRef.current = null;
          }
          lastTapUpRef.current = null;
          if (latestTransRef.current.recording) {
            latestTransRef.current.stop();
            pushTrace(`PTT double-tap stop`);
            pillDispatch({ type: "PTT_STOP" });
          } else {
            // Start dictation on double-tap: play sound and start mic immediately
            try { playToggleOn(); } catch {}
            pillDispatch({ type: "PTT_START" });
            pushTrace(`PTT double-tap start`);
            // Start capture immediately to minimize perceived latency
            try { latestTransRef.current.start(); } catch {}
            // Run auth/mic checks in the background and cancel if they fail
            (async () => {
              const allowed = await canProceedWithStartBasedOnMicPermission();
              if (!allowed) {
                try {
                  const mic = await window.electron?.checkMicrophonePermission?.();
                  const msg = mic && mic.granted === false
                    ? "Microphone permission is off. Double-click to open Settings."
                    : "Sign in to dictate";
                  // Cancel any active/in-flight session and notify
                  try { latestTransRef.current.cancel(); } catch {}
                  pillDispatch({ type: "CANCEL" });
                  pillDispatch({ type: "NOTIFY", msg });
                } catch {
                  try { latestTransRef.current.cancel(); } catch {}
                  pillDispatch({ type: "CANCEL" });
                }
              }
            })();
          }
        } else {
          // First tap: arm the window for a second tap
          lastTapUpRef.current = now;
          if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = setTimeout(() => {
            lastTapUpRef.current = null;
            doubleTapTimerRef.current = null;
          }, DOUBLE_MS);
        }
      }
      isLongPressRef.current = false;
    };

    const debouncedKeyDown = debounce(handleFunctionKeyDown, 25);
    const debouncedKeyUp = debounce(handleFunctionKeyUp, 25);

    const cleanupOnDown = window.ptt.onDown(debouncedKeyDown);
    const cleanupOnUp = window.ptt.onUp(debouncedKeyUp);

    return () => {
      cleanupOnDown();
      cleanupOnUp();
      if (doubleTapTimerRef.current) {
        clearTimeout(doubleTapTimerRef.current);
        doubleTapTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
      <Pill
        pillState={pillState}
        pillContext={pillContext}
        notifWidth={notifWidth}
        isTextTruncated={isTextTruncated}
        dims={{
          baseW: BASE_W,
          baseH: BASE_H,
          restingH: RESTING_H,
          expandedW: EXPANDED_W,
          expandedH: EXPANDED_H,
          maxW: MAX_W,
        }}
        onStartDictation={async () => {
          // Immediate audio feedback on click start
          try {
            playToggleOn();
          } catch {}
          // Immediate visual drop
          pillDispatch({ type: "PTT_START" });
          const allowed = await canProceedWithStartBasedOnMicPermission();
          if (!allowed) {
            try {
              const mic = await window.electron?.checkMicrophonePermission?.();
              const msg = mic && mic.granted === false
                ? "Microphone permission is off. Double-click to open Settings."
                : "Sign in to dictate";
              pillDispatch({ type: "CANCEL" });
              pillDispatch({ type: "NOTIFY", msg });
            } catch {
              pillDispatch({ type: "CANCEL" });
            }
            return;
          }
          trans.start();
        }}
        onStopDictation={() => {
          pillDispatch({ type: "PTT_STOP" });
          trans.stop();
        }}
        onHoverChange={(h) =>
          pillDispatch({ type: h ? "HOVER_ENTER" : "HOVER_LEAVE" })
        }
        onMetrics={handlePillMetrics}
        onAnimDone={() => pillDispatch({ type: "ANIM_DONE" })}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onExpand={() => pillDispatch({ type: "EXPAND" })}
        onCollapse={() => {
          pillDispatch({ type: "COLLAPSE" });
          // If a deferred hide is pending (from toggle while expanded), show the heads-up now
          if (
            pendingHideAfterCollapse.active &&
            pendingHideAfterCollapse.message
          ) {
            setTimeout(() => {
              try {
                window.notifications?.send?.(pendingHideAfterCollapse.message);
              } catch {}
            }, 0);
          }
        }}
        onToggleFloatingBar={async (enabled: boolean) => {
          // Cancel any pending hide if user turns it back on
          if (enabled) {
            setPendingHideAfterCollapse({ active: false, message: "" });
            // Ensure pill is in clean IDLE state when showing the floating bar
            if (pillState !== "LISTENING" && pillState !== "PROCESSING") {
              pillDispatch({ type: "ANIM_DONE" }); // Reset to IDLE state
            }
            try {
              await window.electron?.showFloatingBar?.();
            } catch {}
            return;
          }

          const message = "Floating bar hidden. Use the tray to bring it back.";
          // If expanded, defer notification until collapse to avoid jank
          if (pillState === "EXPANDED") {
            setPendingHideAfterCollapse({ active: true, message });
            return;
          }
          // If not expanded, show heads-up now and then hide after it settles
          notifyThenHide(message);
        }}
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

export default App;
