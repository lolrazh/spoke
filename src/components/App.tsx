import React, { useState, useEffect, useRef, useCallback, useReducer } from "react";
import Pill from "./Pill";
// Import the new consolidated hook
import { useTranscription } from "../hooks/useTranscription"; // Adjust path if needed
import { ISLAND_HIDDEN_Y, ISLAND_VISIBLE_Y } from "../constants/window";
import { PILL_ANIMATION_DURATION } from "../constants/animations";
import { TOKENS } from "../config/uiTokens";
// Remove old audio import
// import { startRecording, stopRecording } from '../lib/audio';

// Define the type for our new "notification play" state
type NotificationPlay = {
  text: string;
  phase: "shrinking" | "showing";
};

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
          return { state: 'NOTIF_SHRINK', context: { ...state.context, notifMsg: state.context.pendingNotif, pendingNotif: undefined } };
        }
        return { ...state, state: 'IDLE' };
      }
      return state;
    case 'NOTIF_SHRINK':
      if (event.type === 'PTT_START') return { state: 'LISTENING', context: { ...state.context, pendingNotif: state.context.notifMsg } };
      if (event.type === 'MEASURED') return { ...state, context: { ...state.context, notifWidth: event.w } };
      if (event.type === 'ANIM_DONE') return { state: 'NOTIF_SHOW', context: { ...state.context } };
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

// Custom hook for pill machine
const usePillMachine = () => {
  const [machine, dispatch] = useReducer((state: PillMachineState, event: PillEvent) => {
    console.log(`[Reducer] Dispatching ${event.type}`);
    return pillReducer(state, event);
  }, { state: 'IDLE', context: {} });
  return { state: machine.state, context: machine.context, dispatch };
};

const WORDS_PER_MINUTE = 200;
const MIN_VIEW_TIME_MS = 2000; // 2 seconds minimum
const EXTRA_VIEW_TIME_MS = 500; // 0.5 seconds buffer

/**
 * Calculates how long a notification should be visible based on its word count.
 * @param text The notification text.
 * @returns The visibility duration in milliseconds.
 */
const calculateNotificationDuration = (text: string): number => {
  const wordCount = text.trim().split(/\s+/).length;
  const readingTime = (wordCount / WORDS_PER_MINUTE) * 60 * 1000; // in ms
  return Math.max(MIN_VIEW_TIME_MS, readingTime + EXTRA_VIEW_TIME_MS);
};

// Define the type for the metrics callback
type PillMetrics = {
  pillRect: DOMRect | null;
  notificationText: string | null;
  devicePixelRatio: number;
};

const App: React.FC = () => {
  const [debugInfo, setDebugInfo] = useState<PillMetrics | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const trans = useTranscription();
  const [isHovered, setIsHovered] = useState(false);
  const [notificationPlay, setNotificationPlay] = useState<NotificationPlay | null>(null);
  const notificationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);
  // Ref to always hold the latest trans object for use in callbacks
  const latestTransRef = useRef(trans);

  const [trace, setTrace] = useState<string[]>([]);
  const pushTrace = (msg: string) => {
    setTrace(t => [`${performance.now().toFixed(0)}: ${msg}`, ...t.slice(0, 15)]);
  };

  // --- Show/Hide Debug HUD ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowDebug(params.has("debugPill"));
  }, []);

  // --- Update latestTransRef whenever trans changes ---
  useEffect(() => {
    latestTransRef.current = trans;
  }, [trans]);

  const { state: pillState, context: pillContext, dispatch: pillDispatch } = usePillMachine();

  // --- Map hook state to Pill props ---
  const isListening = trans.recording;
  // Show processing during model load AND transcription
  const isProcessing = !trans.ready || trans.processing;

  // --- Handle Transcription Results ---
  useEffect(() => {
    if (trans.text && !trans.recording && !trans.processing) {
      console.log(
        `[App] Final accumulated transcription state: "${trans.text}"`,
      );
      pushTrace(`Transcription complete: "${trans.text}" `);
      pillDispatch({ type: 'PROCESSING_COMPLETE' });
    }
  }, [trans.text, trans.recording, trans.processing]);

  // --- Handle Errors from Hook ---
  useEffect(() => {
    if (trans.error) {
      // Use the new notifications API
      window.notifications.send(trans.error);
      pushTrace(`Error: ${trans.error}`);
    }
  }, [trans.error]);

  // --- Global Notification Listener (The "Director") ---
  useEffect(() => {
    const cleanup = window.notifications.on((message: string) => {
      console.log(`[App] Kicking off notification play: "${message}" `);
      pushTrace(`Notify: "${message}" `);
      pillDispatch({ type: 'NOTIFY', msg: message });
    });

    return cleanup;
  }, []);

  // --- Derived State for Pill Visibility ---
  const isPillVisible = pillState !== 'IDLE';

  // Island slide-in/out effect
  useEffect(() => {
    // Use the new island API
    if (window.island?.slideTo) {
      const isPillVisible = pillState !== 'IDLE';
      const targetY = isPillVisible ? ISLAND_VISIBLE_Y : ISLAND_HIDDEN_Y;
      console.log(
        `[App] Sliding to ${targetY} (pillState: ${pillState})`,
      );
      pushTrace(`Sliding island to Y: ${targetY}`);
      window.island.slideTo(targetY);
    }
  }, [pillState]);

  // Measurement effect for NOTIF_SHRINK
  useEffect(() => {
    if (pillState === 'NOTIF_SHRINK' && pillContext.notifMsg) {
      const measure = () => {
        const ghost = document.getElementById('pill-ghost-measure');
        if (ghost) {
          ghost.textContent = pillContext.notifMsg;
          const w = ghost.offsetWidth + TOKENS.NOTIF_PAD_X;
          const clampedW = Math.max(100, Math.min(w, TOKENS.PILL_MAX_W));
          pillDispatch({ type: 'MEASURED', w: clampedW });
          console.log(`[App] Measured width: ${clampedW}`);
        }
      };
      requestAnimationFrame(measure);
    }
  }, [pillState, pillContext.notifMsg]);

  // Fallback ANIM_DONE for NOTIF_SHRINK and NOTIF_SHOW
  useEffect(() => {
    if (pillState === 'NOTIF_SHRINK' || pillState === 'NOTIF_SHOW') {
      const timeout = setTimeout(() => {
        pillDispatch({ type: 'ANIM_DONE' });
      }, PILL_ANIMATION_DURATION + 100); // Slight buffer
      return () => clearTimeout(timeout);
    }
  }, [pillState]);

  // Notification duration for NOTIF_SHOW
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
  }, []); // Empty dependency array ensures the function is not recreated on re-renders

  // Set up global PTT hotkey listeners
  useEffect(() => {
    // Use the new PTT API
    if (!window.ptt?.onDown || !window.ptt?.onUp) return;

    const HOLD_DURATION_MS = 180;

    const handleFunctionKeyDown = () => {
      pushTrace(`PTT down`);
      // Always clear the previous timer on a new key down event.
      // This correctly handles keyboard repeats.
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }

      // Don't start a new timer if PTT is already active from a long press.
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

      // Use the ref to ensure we have the latest functions and state.
      if (isLongPressRef.current) {
        if (latestTransRef.current.recording) {
          latestTransRef.current.stop();
          pushTrace(`PTT long press stop`);
          pillDispatch({ type: 'PTT_STOP' });
        }
      } else {
        // Toggle behavior for short press
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

    console.log("[PTT] Setting up PTT listeners");
    const unsubscribePTTDown = window.ptt.onDown(handleFunctionKeyDown);
    const unsubscribePTTUp = window.ptt.onUp(handleFunctionKeyUp);

    return () => {
      console.log("[PTT] Cleaning up PTT listeners");
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      unsubscribePTTDown();
      unsubscribePTTUp();
    };
  }, []); // Removed dependencies as we are now using a ref

  return (
    <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
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
