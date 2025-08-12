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
import { ISLAND_HIDDEN_Y, ISLAND_VISIBLE_Y, CONTENT_WIDTH, CONTENT_HEIGHT } from "../constants/window";
import { TOKENS } from "../config/uiTokens";

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
      if (event.type === "NOTIFY")
        return {
          ...state,
          context: { ...state.context, pendingNotif: event.msg },
        };
      return state;
    case "PROCESSING":
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

const App: React.FC = () => {
  const [debugInfo, setDebugInfo] = useState<PillMetrics | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [uiScale, setUiScale] = useState(1);
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
  const isLongPressRef = useRef(false);
  const latestTransRef = useRef(trans);
  const [trace, setTrace] = useState<string[]>([]);

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
    window.onActiveDisplay?.((payload: any) => {
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

  // Listen for expand pill requests from main process
  useEffect(() => {
    const handleExpandPill = () => {
      pillDispatch({ type: "EXPAND" });
      // Ensure OS uses our window for cursor during expanded mode
      window.electron?.setClickThrough(false);
      window.electron?.setFocusable?.(true);
    };

    window.electron?.expandPill?.(handleExpandPill);

    // Note: No cleanup needed as this is a one-time setup
  }, []);

  // Ensure click-through is properly managed based on pill state
  useEffect(() => {
    if (pillState === "EXPANDED") {
      window.electron?.setClickThrough(false);
      window.electron?.setFocusable?.(true);
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
    const handler = () => {
      pillDispatch({ type: "COLLAPSE" });
    };
    const { ipcRenderer } = (window as any).require ? (window as any).require('electron') : {};
    // Use preload bridge: listen via notifications or add a simple event bus
    // Fallback to window-level event: bind to 'collapse-request' sent by main
    const listener = (_e?: any) => handler();
    try {
      // Bind with the global ipc exposed event if available
      // @ts-ignore: runtime channel subscription via window
      window?.electron && window?.electron?.setFocusable; // no-op use to ensure bridge loads
      // Bind directly on DOM for simplicity
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).electronCollapseRequest = listener;
    } catch {}
    // Attach via IPC event from preload? We don't have a typed hook; rely on DOM event from preload send
    const onMessage = (ev: MessageEvent) => {
      if (ev.data === 'collapse-request') handler();
    };
    window.addEventListener('message', onMessage);
    // Also create a small ipc-based listener via postMessage from preload (sent already from main)
    // The preload isn't forwarding this yet; we'll handle in renderer via webContents 'collapse-request' by injecting postMessage.
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [pillState]);

  // During onboarding we avoid fighting with onboarding's request to expand the pill.
  // Keep native window stationary here; expansion is driven by renderer UI state.

  // Notification duration for NOTIFICATION
  useEffect(() => {
    if (pillState === "NOTIFICATION" && pillContext.notifMsg) {
      const timeout = setTimeout(() => {
        pillDispatch({ type: "ANIM_DONE" });
      }, NOTIFICATION_DURATION_MS);
      return () => clearTimeout(timeout);
    }
  }, [pillState, pillContext.notifMsg]);

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

    const HOLD_DURATION_MS = 180;

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
        pushTrace(`PTT long press start`);
        pillDispatch({ type: "PTT_START" });
        if (!latestTransRef.current.recording) {
          try {
            const mic = await window.electron?.checkMicrophonePermission?.();
            if (!mic?.granted) {
              window.notifications?.send?.("Microphone permission is off. Double-click to open Settings.");
              return;
            }
          } catch (_) {
            // Fall through and attempt to start; useTranscription will surface errors
          }
          latestTransRef.current.start();
        }
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
        if (latestTransRef.current.recording) {
          latestTransRef.current.stop();
          pushTrace(`PTT short press stop`);
          pillDispatch({ type: "PTT_STOP" });
        } else {
          (async () => {
            try {
              const mic = await window.electron?.checkMicrophonePermission?.();
              if (!mic?.granted) {
                window.notifications?.send?.("Microphone permission is off. Double-click to open Settings.");
                return;
              }
            } catch (_) {}
            latestTransRef.current.start();
          })();
          pushTrace(`PTT short press start`);
          pillDispatch({ type: "PTT_START" });
        }
      }
      isLongPressRef.current = false;
    };

    const debouncedKeyDown = debounce(handleFunctionKeyDown, 50);
    const debouncedKeyUp = debounce(handleFunctionKeyUp, 50);

    const cleanupOnDown = window.ptt.onDown(debouncedKeyDown);
    const cleanupOnUp = window.ptt.onUp(debouncedKeyUp);

    return () => {
      cleanupOnDown();
      cleanupOnUp();
    };
  }, []);

  return (
    <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
      <Pill
        pillState={pillState}
        pillContext={pillContext}
        notifWidth={notifWidth}
        isTextTruncated={isTextTruncated}
        dims={{ baseW: BASE_W, baseH: BASE_H, restingH: RESTING_H, expandedW: EXPANDED_W, expandedH: EXPANDED_H, maxW: MAX_W }}
        onStartDictation={async () => {
          pillDispatch({ type: "PTT_START" });
          try {
            const mic = await window.electron?.checkMicrophonePermission?.();
            if (!mic?.granted) {
              window.notifications?.send?.("Microphone permission is off. Double-click to open Settings.");
              return;
            }
          } catch (_) {}
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
        onCollapse={() => pillDispatch({ type: "COLLAPSE" })}
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
