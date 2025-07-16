import React, { useState, useEffect, useRef, useCallback, useReducer } from "react";
import Pill from "./Pill";
import { useTranscription } from "../hooks/useTranscription";
import { ISLAND_HIDDEN_Y, ISLAND_VISIBLE_Y } from "../constants/window";
import { TOKENS } from "../config/uiTokens";
import { useGhostMeasure } from "../hooks/useGhostMeasure";

// Pill State Machine Types
export type PillStateType =
  | 'IDLE'
  | 'LISTENING'
  | 'PROCESSING'
  | 'NOTIF_SHRINK'
  | 'NOTIF_SHOW'
  | 'HOVER_PREVIEW';

export type PillEvent =
  | { type: 'PTT_START' }
  | { type: 'PTT_STOP' }
  | { type: 'NOTIFY'; msg: string }
  | { type: 'MEASURED'; w: number }
  | { type: 'ANIM_DONE' }
  | { type: 'HOVER_ENTER' }
  | { type: 'HOVER_LEAVE' }
  | { type: 'PROCESSING_COMPLETE' };

export interface PillMachineState {
  state: PillStateType;
  context: {
    pendingNotif?: string;
    notifWidth?: number;
    notifMsg?: string;
  };
}

// Reducer function for pill machine
const pillReducer = (state: PillMachineState, event: PillEvent): PillMachineState => {
  switch (state.state) {
    case 'IDLE':
      if (event.type === 'PTT_START') return { ...state, state: 'LISTENING' };
      if (event.type === 'NOTIFY') return { state: 'NOTIF_SHRINK', context: { ...state.context, notifMsg: event.msg } };
      if (event.type === 'HOVER_ENTER') return { ...state, state: 'HOVER_PREVIEW' };
      return state;
    case 'LISTENING':
      if (event.type === 'PTT_STOP') return { ...state, state: 'PROCESSING' };
      if (event.type === 'NOTIFY') return { ...state, context: { ...state.context, pendingNotif: event.msg } };
      return state;
    case 'PROCESSING':
      if (event.type === 'PROCESSING_COMPLETE') {
        if (state.context.pendingNotif) {
          return { state: 'NOTIF_SHRINK', context: { notifMsg: state.context.pendingNotif, pendingNotif: undefined } };
        }
        return { ...state, state: 'IDLE' };
      }
      return state;
    case 'NOTIF_SHRINK':
      if (event.type === 'PTT_START') return { state: 'LISTENING', context: { ...state.context, pendingNotif: state.context.notifMsg } };
      if (event.type === 'MEASURED') {
        return { state: 'NOTIF_SHOW', context: { ...state.context, notifWidth: event.w } };
      }
      return state;
    case 'NOTIF_SHOW':
      if (event.type === 'PTT_START') return { state: 'LISTENING', context: { ...state.context, pendingNotif: state.context.notifMsg } };
      if (event.type === 'ANIM_DONE') return { ...state, state: 'IDLE', context: { ...state.context, notifMsg: undefined, notifWidth: undefined } };
      return state;
    case 'HOVER_PREVIEW':
      if (event.type === 'HOVER_LEAVE') return { ...state, state: 'IDLE' };
      return state;
    default:
      return state;
  }
};

const WORDS_PER_MINUTE = 180;
const MIN_VIEW_TIME_MS = 2500;
const EXTRA_VIEW_TIME_MS = 1000;

const calculateNotificationDuration = (text: string): number => {
  const wordCount = text.trim().split(/\s+/).length;
  const readingTime = (wordCount / WORDS_PER_MINUTE) * 60 * 1000;
  return Math.max(MIN_VIEW_TIME_MS, readingTime + EXTRA_VIEW_TIME_MS);
};

type PillMetrics = {
  pillRect: DOMRect | null;
  notificationText: string | null;
  devicePixelRatio: number;
};

const NotificationWidthMeasurer: React.FC<{
  text: string;
  onMeasured: (width: number) => void;
}> = ({ text, onMeasured }) => {
  const measuredWidth = useGhostMeasure(text);

  useEffect(() => {
    if (measuredWidth > 0) {
      const paddedWidth = measuredWidth + TOKENS.NOTIF_PAD_X;
      const clampedWidth = Math.max(
        TOKENS.PILL_BASE_W,
        Math.min(paddedWidth, TOKENS.PILL_MAX_W)
      );
      setTimeout(() => onMeasured(clampedWidth), 50);
    }
  }, [measuredWidth, onMeasured]);

  return null;
};

const usePillMachine = () => {
  const [machine, dispatch] = useReducer((state: PillMachineState, event: PillEvent) => {
    console.log(`[Reducer] Dispatching ${event.type}`);
    return pillReducer(state, event);
  }, { state: 'IDLE', context: {} });
  return { state: machine.state, context: machine.context, dispatch };
};

const App: React.FC = () => {
  const [debugInfo, setDebugInfo] = useState<PillMetrics | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const trans = useTranscription();
  const [isHovered, setIsHovered] = useState(false);
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);
  const latestTransRef = useRef(trans);
  const [trace, setTrace] = useState<string[]>([]);
  
  const pushTrace = (msg: string) => {
    setTrace(t => [`${performance.now().toFixed(0)}: ${msg}`, ...t.slice(0, 15)]);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowDebug(params.has("debugPill"));
  }, []);

  useEffect(() => {
    latestTransRef.current = trans;
  }, [trans]);

  const { state: pillState, context: pillContext, dispatch: pillDispatch } = usePillMachine();

  useEffect(() => {
    if (trans.text && !trans.recording && !trans.processing) {
      pushTrace(`Transcription complete: "${trans.text}" `);
      pillDispatch({ type: 'PROCESSING_COMPLETE' });
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
      pillDispatch({ type: 'NOTIFY', msg: message });
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (window.island?.slideTo) {
      const isPillVisible = pillState !== 'IDLE';
      const targetY = isPillVisible ? ISLAND_VISIBLE_Y : ISLAND_HIDDEN_Y;
      window.island.slideTo(targetY);
    }
  }, [pillState]);

  useEffect(() => {
    if (pillState === 'NOTIF_SHOW' && pillContext.notifMsg) {
      const duration = calculateNotificationDuration(pillContext.notifMsg);
      const timeout = setTimeout(() => {
        pillDispatch({ type: 'ANIM_DONE' });
      }, duration);
      return () => clearTimeout(timeout);
    }
  }, [pillState, pillContext.notifMsg]);

  const handlePillMetrics = useCallback((metrics: PillMetrics) => {
    setDebugInfo(metrics);
  }, []);

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
        pillDispatch({ type: 'PTT_START' });
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
          pillDispatch({ type: 'PTT_STOP' });
        }
      } else {
        if (latestTransRef.current.recording) {
          latestTransRef.current.stop();
          pushTrace(`PTT short press stop`);
          pillDispatch({ type: 'PTT_STOP' });
        } else {
          latestTransRef.current.start();
          pushTrace(`PTT short press start`);
          pillDispatch({ type: 'PTT_START' });
        }
      }
      isLongPressRef.current = false;
    };

    const unsubscribePTTDown = window.ptt.onDown(handleFunctionKeyDown);
    const unsubscribePTTUp = window.ptt.onUp(handleFunctionKeyUp);

    return () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      unsubscribePTTDown();
      unsubscribePTTUp();
    };
  }, []);

  return (
    <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
      {pillState === 'NOTIF_SHRINK' && pillContext.notifMsg && (
        <NotificationWidthMeasurer
          text={pillContext.notifMsg}
          onMeasured={(w) => pillDispatch({ type: 'MEASURED', w })}
        />
      )}
      <Pill
        pillState={pillState}
        pillContext={pillContext}
        onStartDictation={trans.start}
        onStopDictation={trans.stop}
        onHoverChange={(hovered) => {
          setIsHovered(hovered);
          pillDispatch(hovered ? { type: 'HOVER_ENTER' } : { type: 'HOVER_LEAVE' });
        }}
        onMetrics={handlePillMetrics}
        onAnimDone={() => pillDispatch({ type: 'ANIM_DONE' })}
      />
      <span
        id="pill-ghost-measure"
        className="notification-text fixed left-[-9999px] top-[-9999px] pointer-events-none whitespace-nowrap"
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
          <p>Notif Chars: {debugInfo.notificationText?.length ?? "N/A"}</p>
          <p>Notif Words: {debugInfo.notificationText?.split(/\s+/).filter(Boolean).length ?? "N/A"}</p>
          <p>Device Pixel Ratio: {debugInfo.devicePixelRatio}</p>
          <div style={{ marginTop: '10px', borderTop: '1px solid white' }}>
            <p>Trace (last 15 events):</p>
            <ul style={{ listStyle: 'none', padding: 0 }}>
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
