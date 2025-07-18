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
import { ISLAND_HIDDEN_Y, ISLAND_VISIBLE_Y } from "../constants/window";
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
      if (event.type === "EXPAND")
        return { ...state, state: "EXPANDED" };
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
      if (event.type === "EXPAND") return { ...state, state: "EXPANDED" };
      return state;
    case "EXPANDED":
      if (event.type === "COLLAPSE") return { ...state, state: "IDLE" };
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

const debounce = <T extends (...args: any[]) => void>(
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
  const trans = useTranscription();
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

  const {
    state: pillState,
    context: pillContext,
    dispatch: pillDispatch,
  } = usePillMachine();

  useEffect(() => {
    if (trans.text && !trans.recording && !trans.processing) {
      pushTrace(`Transcription complete: "${trans.text}" `);
      pillDispatch({ type: "PROCESSING_COMPLETE" });
    }
  }, [trans.text, trans.recording, trans.processing]);

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
    };

    window.electron?.expandPill?.(handleExpandPill);
    
    // Note: No cleanup needed as this is a one-time setup
  }, []);

  const slideToDebounced = useCallback(
    debounce((y: number) => {
      window.island?.slideTo(y);
    }, 100),
    [],
  );

  useEffect(() => {
    const isPillVisible = pillState !== "IDLE";
    const targetY = isPillVisible ? ISLAND_VISIBLE_Y : ISLAND_HIDDEN_Y;
    slideToDebounced(targetY);
  }, [pillState, slideToDebounced]);

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
    window.electron?.setClickThrough(true);
  }, []);

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
    const clampedWidth = Math.min(measuredWidth, TOKENS.PILL_MAX_W);
    // Check if text will be truncated
    const isTruncated = measuredWidth > TOKENS.PILL_MAX_W;

    setNotifWidth(clampedWidth);
    setIsTextTruncated(isTruncated);
  }, [pillContext.notifMsg]);

  useEffect(() => {
    if (!window.ptt?.onDown || !window.ptt?.onUp) return;

    const HOLD_DURATION_MS = 180;

    const handleFunctionKeyDown = () => {
      pushTrace(`PTT down`);
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      if (latestTransRef.current.recording) {
        return;
      }
      isLongPressRef.current = false;
      pressTimerRef.current = setTimeout(() => {
        isLongPressRef.current = true;
        pushTrace(`PTT long press start`);
        pillDispatch({ type: "PTT_START" });
        if (!latestTransRef.current.recording) {
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
          latestTransRef.current.start();
          pushTrace(`PTT short press start`);
          pillDispatch({ type: "PTT_START" });
        }
      }
      isLongPressRef.current = false;
    };

    const cleanupOnDown = window.ptt.onDown(handleFunctionKeyDown);
    const cleanupOnUp = window.ptt.onUp(handleFunctionKeyUp);

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
        onStartDictation={() => {
          pillDispatch({ type: "PTT_START" });
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
