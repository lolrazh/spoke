/**
 * Push-to-talk gesture state machine.
 *
 * Pure, deterministic model of the tap / hold / double-tap gesture shape that
 * previously lived as ~15 refs inside an App.tsx effect. The machine only
 * classifies raw key down/up + timer events into "please start/stop/cancel
 * a capture" commands (effects) — it never touches the DOM, timers, or the
 * transcription hook directly. A thin driver (see
 * src/hooks/usePttGestures.ts) owns the actual setTimeout calls and the
 * async start/stop/cancel calls, and feeds their outcomes back in as events
 * (captureStarted / captureRejected).
 *
 * This intentionally mirrors the original ref-based implementation's
 * semantics exactly, including a couple of quirks that look odd in
 * isolation but are load-bearing for existing behavior:
 *  - Releasing the key while a hold-capture is still starting does NOT
 *    immediately call cancelCapture; it defers the decision (via
 *    `pendingPostStartActions`) until the async start resolves.
 *  - Releasing while a double-tap-capture is still starting (because a
 *    third tap arrived) DOES cancel immediately, without deferring.
 *  - `externalCancel` deliberately does not clear `session` /
 *    `pendingPostStartActions` bookkeeping (the original didn't either);
 *    a later captureStarted for that stale session is caught by a safety
 *    net (see `handleCaptureStarted`) once the key is no longer down.
 */

import { HOLD_DURATION_MS, DOUBLE_TAP_MS } from "../constants/gestures";

export type GestureKind = "hold" | "doubleTap";
export type CaptureSessionPhase = "starting" | "active";
export type PendingCaptureAction = "stop" | "cancel";
export type CaptureRejectReason = "denied" | "error";

export interface CaptureSession {
  token: number;
  kind: GestureKind;
  phase: CaptureSessionPhase;
}

export interface GestureMachineState {
  /** Mirrors isOptionDownRef — is the PTT key currently physically down. */
  keyDown: boolean;
  /** Mirrors isLongPressRef. */
  isLongPress: boolean;
  /** Mirrors startCuePlayedRef — prevents double-playing the start chime. */
  startCuePlayed: boolean;
  /** Token identifying the currently-armed hold timer, or null if none. */
  holdTimerToken: number | null;
  /** Timestamp (ms) of the last qualifying tap-up, or null if no window is open. */
  pendingTapAt: number | null;
  /** The in-flight or active capture session, mirrors activeCaptureRef. */
  session: CaptureSession | null;
  /** Mirrors postStartActionRef — deferred stop/cancel keyed by token. */
  pendingPostStartActions: Record<number, PendingCaptureAction>;
  /** Monotonic counter mirroring gestureTokenCounterRef. */
  nextToken: number;
}

export type GestureEvent =
  | { type: "keyDown"; processing: boolean; recording: boolean }
  | { type: "keyUp"; now: number; recording: boolean }
  | { type: "holdTimerFired"; timerToken: number }
  | { type: "doubleTapWindowExpired" }
  | { type: "captureStarted"; token: number }
  | { type: "captureRejected"; token: number; reason: CaptureRejectReason }
  | { type: "externalCancel"; wasRecording: boolean; wasProcessing: boolean };

export type GestureEffect =
  | { type: "armHoldTimer"; timerToken: number; ms: number }
  | { type: "clearHoldTimer" }
  | { type: "armDoubleTapTimer"; ms: number }
  | { type: "clearDoubleTapTimer" }
  | { type: "playStartCue" }
  | { type: "dispatchPttStart" }
  | { type: "dispatchPttStop" }
  | { type: "dispatchCancel" }
  | { type: "startCapture"; token: number; kind: GestureKind }
  | { type: "stopCapture" }
  | { type: "cancelCapture" }
  | { type: "notifyBusy" };

export interface GestureTransitionResult {
  state: GestureMachineState;
  effects: GestureEffect[];
}

export const createInitialGestureState = (): GestureMachineState => ({
  keyDown: false,
  isLongPress: false,
  startCuePlayed: false,
  holdTimerToken: null,
  pendingTapAt: null,
  session: null,
  pendingPostStartActions: {},
  nextToken: 0,
});

function withoutPendingAction(
  actions: Record<number, PendingCaptureAction>,
  token: number,
): Record<number, PendingCaptureAction> {
  if (!(token in actions)) return actions;
  const next = { ...actions };
  delete next[token];
  return next;
}

function handleKeyDown(
  state: GestureMachineState,
  event: Extract<GestureEvent, { type: "keyDown" }>,
): GestureTransitionResult {
  if (state.keyDown) {
    // Already down (e.g. OS key-repeat) — ignored entirely, matches original.
    return { state, effects: [] };
  }

  const effects: GestureEffect[] = [];
  if (state.holdTimerToken != null) {
    effects.push({ type: "clearHoldTimer" });
  }

  if (event.processing) {
    return {
      state: {
        ...state,
        keyDown: false,
        startCuePlayed: false,
        holdTimerToken: null,
      },
      effects: [...effects, { type: "notifyBusy" }],
    };
  }

  if (event.recording) {
    // Hands-free capture already active; treat as a "key down" for the
    // purposes of the eventual key-up, but never arm the hold timer.
    return {
      state: {
        ...state,
        keyDown: true,
        startCuePlayed: false,
        holdTimerToken: null,
      },
      effects,
    };
  }

  const timerToken = state.nextToken;
  return {
    state: {
      ...state,
      keyDown: true,
      startCuePlayed: false,
      isLongPress: false,
      holdTimerToken: timerToken,
      nextToken: state.nextToken + 1,
    },
    effects: [
      ...effects,
      { type: "armHoldTimer", timerToken, ms: HOLD_DURATION_MS },
    ],
  };
}

function handleHoldTimerFired(
  state: GestureMachineState,
  event: Extract<GestureEvent, { type: "holdTimerFired" }>,
): GestureTransitionResult {
  if (state.holdTimerToken !== event.timerToken || !state.keyDown) {
    // Stale timer (superseded by a newer keyDown) or the key was already
    // lifted before this fired — the key-up handler already dealt with it.
    return { state, effects: [] };
  }

  const effects: GestureEffect[] = [];
  if (state.pendingTapAt != null) {
    effects.push({ type: "clearDoubleTapTimer" });
  }
  if (!state.startCuePlayed) {
    effects.push({ type: "playStartCue" });
  }

  const tokenId = state.nextToken;
  effects.push({ type: "dispatchPttStart" });
  effects.push({ type: "startCapture", token: tokenId, kind: "hold" });

  return {
    state: {
      ...state,
      isLongPress: true,
      holdTimerToken: null,
      startCuePlayed: true,
      pendingTapAt: null,
      session: { token: tokenId, kind: "hold", phase: "starting" },
      nextToken: state.nextToken + 1,
    },
    effects,
  };
}

function handleDoubleTapWindowExpired(
  state: GestureMachineState,
): GestureTransitionResult {
  if (state.pendingTapAt == null) return { state, effects: [] };
  return { state: { ...state, pendingTapAt: null }, effects: [] };
}

function handleKeyUp(
  state: GestureMachineState,
  event: Extract<GestureEvent, { type: "keyUp" }>,
): GestureTransitionResult {
  if (!state.keyDown) {
    // No active press to conclude — still clears any open double-tap
    // window, matching the original's unconditional reset.
    const effects: GestureEffect[] = [];
    if (state.pendingTapAt != null) effects.push({ type: "clearDoubleTapTimer" });
    return { state: { ...state, pendingTapAt: null }, effects };
  }

  const baseEffects: GestureEffect[] = [];
  if (state.holdTimerToken != null) baseEffects.push({ type: "clearHoldTimer" });

  let working: GestureMachineState = {
    ...state,
    keyDown: false,
    holdTimerToken: null,
  };

  if (working.isLongPress) {
    const activeHold =
      working.session && working.session.kind === "hold" ? working.session : null;

    if (event.recording) {
      working = { ...working, isLongPress: false };
      if (activeHold) working = { ...working, session: null };
      return {
        state: working,
        effects: [
          ...baseEffects,
          { type: "stopCapture" },
          { type: "dispatchPttStop" },
        ],
      };
    }

    let pendingPostStartActions = working.pendingPostStartActions;
    if (activeHold) {
      pendingPostStartActions = {
        ...pendingPostStartActions,
        [activeHold.token]: "cancel",
      };
    }
    working = { ...working, isLongPress: false, pendingPostStartActions };
    return {
      state: working,
      effects: [...baseEffects, { type: "dispatchCancel" }],
    };
  }

  // Tap classification (quick tap vs. second tap of a double-tap).
  const withinDoubleTapWindow =
    working.pendingTapAt != null &&
    event.now - working.pendingTapAt <= DOUBLE_TAP_MS;

  if (!withinDoubleTapWindow) {
    return {
      state: { ...working, pendingTapAt: event.now },
      effects: [...baseEffects, { type: "armDoubleTapTimer", ms: DOUBLE_TAP_MS }],
    };
  }

  const pendingHandsFree = working.session?.kind === "doubleTap";
  working = { ...working, pendingTapAt: null };
  const effects: GestureEffect[] = [
    ...baseEffects,
    { type: "clearDoubleTapTimer" },
  ];

  if (event.recording) {
    if (working.session?.kind === "doubleTap") {
      working = { ...working, session: null };
    }
    effects.push({ type: "stopCapture" }, { type: "dispatchPttStop" });
    return { state: working, effects };
  }

  if (pendingHandsFree) {
    working = { ...working, session: null };
    effects.push({ type: "cancelCapture" }, { type: "dispatchCancel" });
    return { state: working, effects };
  }

  const tokenId = working.nextToken;
  if (!working.startCuePlayed) {
    effects.push({ type: "playStartCue" });
  }
  effects.push({ type: "dispatchPttStart" });
  effects.push({ type: "startCapture", token: tokenId, kind: "doubleTap" });
  working = {
    ...working,
    startCuePlayed: true,
    nextToken: working.nextToken + 1,
    session: { token: tokenId, kind: "doubleTap", phase: "starting" },
  };
  return { state: working, effects };
}

function handleCaptureStarted(
  state: GestureMachineState,
  event: Extract<GestureEvent, { type: "captureStarted" }>,
): GestureTransitionResult {
  const { token } = event;
  const scheduled = state.pendingPostStartActions[token];
  const currentSession =
    state.session && state.session.token === token ? state.session : null;

  if (scheduled) {
    const effects: GestureEffect[] =
      scheduled === "cancel"
        ? [{ type: "cancelCapture" }, { type: "dispatchCancel" }]
        : [{ type: "stopCapture" }, { type: "dispatchPttStop" }];
    return {
      state: {
        ...state,
        pendingPostStartActions: withoutPendingAction(
          state.pendingPostStartActions,
          token,
        ),
        session: currentSession ? null : state.session,
      },
      effects,
    };
  }

  if (!currentSession) {
    // Stale/unknown token with nothing scheduled — silently ignored,
    // matching monitorStartResolution's no-op when nothing was scheduled.
    return { state, effects: [] };
  }

  // Safety net: a hold session whose key is already up (e.g. because an
  // externalCancel fired without going through the normal key-up
  // bookkeeping) should never be left recording once it finally starts.
  if (currentSession.kind === "hold" && !state.keyDown) {
    return {
      state: { ...state, session: null },
      effects: [{ type: "cancelCapture" }, { type: "dispatchCancel" }],
    };
  }

  return {
    state: { ...state, session: { ...currentSession, phase: "active" } },
    effects: [],
  };
}

function handleCaptureRejected(
  state: GestureMachineState,
  event: Extract<GestureEvent, { type: "captureRejected" }>,
): GestureTransitionResult {
  const { token, reason } = event;
  const scheduled = state.pendingPostStartActions[token];
  const currentSession =
    state.session && state.session.token === token ? state.session : null;

  if (reason === "error") {
    // A genuine start failure (sync throw or async rejection): never
    // executes a scheduled action (nothing to stop/cancel) and never
    // dispatches — mirrors monitorStartResolution's .catch(), which only
    // clears the active-capture bookkeeping and discards any scheduled
    // action for this token.
    return {
      state: {
        ...state,
        pendingPostStartActions: withoutPendingAction(
          state.pendingPostStartActions,
          token,
        ),
        session: currentSession ? null : state.session,
      },
      effects: [],
    };
  }

  // reason === "denied": only acts if this gesture hasn't already been
  // concluded another way (matches handlePermissionOutcome's pending-token
  // guard). Crucially, if a postStartAction was already scheduled for this
  // token by an earlier key-up, this is a true no-op — it must NOT consume
  // or otherwise touch that scheduled action, which is still waiting on the
  // eventual captureStarted/captureRejected("error") for the same token.
  if (!currentSession || scheduled) {
    return { state, effects: [] };
  }

  const wasHold = currentSession.kind === "hold";
  return {
    state: {
      ...state,
      session: null,
      isLongPress: wasHold ? false : state.isLongPress,
    },
    effects: [{ type: "cancelCapture" }, { type: "dispatchCancel" }],
  };
}

function handleExternalCancel(
  state: GestureMachineState,
  event: Extract<GestureEvent, { type: "externalCancel" }>,
): GestureTransitionResult {
  const effects: GestureEffect[] = [];
  if (state.holdTimerToken != null) effects.push({ type: "clearHoldTimer" });
  if (state.pendingTapAt != null) effects.push({ type: "clearDoubleTapTimer" });

  const next: GestureMachineState = {
    ...state,
    holdTimerToken: null,
    pendingTapAt: null,
    isLongPress: true,
  };

  if (event.wasRecording || event.wasProcessing) {
    effects.push({ type: "cancelCapture" }, { type: "dispatchCancel" });
  }

  // Deliberately does not touch `session` / `pendingPostStartActions` —
  // the original didn't touch activeCaptureRef/postStartActionRef here
  // either. The forced isLongPress:true means the next key-up will run the
  // long-press conclusion branch, and any late captureStarted for a
  // lingering session is caught by the safety net in handleCaptureStarted.
  return { state: next, effects };
}

export function transition(
  state: GestureMachineState,
  event: GestureEvent,
): GestureTransitionResult {
  switch (event.type) {
    case "keyDown":
      return handleKeyDown(state, event);
    case "keyUp":
      return handleKeyUp(state, event);
    case "holdTimerFired":
      return handleHoldTimerFired(state, event);
    case "doubleTapWindowExpired":
      return handleDoubleTapWindowExpired(state);
    case "captureStarted":
      return handleCaptureStarted(state, event);
    case "captureRejected":
      return handleCaptureRejected(state, event);
    case "externalCancel":
      return handleExternalCancel(state, event);
    default:
      return { state, effects: [] };
  }
}
