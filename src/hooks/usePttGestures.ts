/**
 * Thin driver for the push-to-talk gesture state machine (see
 * src/state/gestureMachine.ts).
 *
 * This hook owns everything the pure machine is not allowed to touch:
 *   - the actual setTimeout/clearTimeout calls backing the hold and
 *     double-tap timers,
 *   - subscribing to window.ptt.onDown/onUp/onCancel,
 *   - the async microphone-permission pre-check that races against the
 *     gesture timers (kicked off eagerly on key-down, exactly like the
 *     original beginPermissionCheck/snapshotPermissionGuard did), and
 *   - calling start()/stop()/cancel() on the transcription hook and
 *     reporting the outcome back into the machine as captureStarted /
 *     captureRejected events.
 *
 * It executes the machine's declarative effects 1:1 and otherwise contains
 * no gesture-shape logic of its own.
 */
import { useEffect, useRef } from "react";
import {
  transition,
  createInitialGestureState,
  type GestureMachineState,
  type GestureEvent,
  type GestureEffect,
} from "../state/gestureMachine";
import type { PillEvent } from "../state/pillStateMachine";
import type { UseTranscriptionReturn } from "./useTranscription";
import { playToggleOn } from "../utils/audioFeedback";

export interface UsePttGesturesOptions {
  /** Always the latest transcription hook return value. */
  trans: UseTranscriptionReturn;
  pillDispatch: (event: PillEvent) => void;
  /** Mirrors the original canProceedWithStart(): resolves false (and is
   * responsible for its own "detected" notification) if the mic permission
   * is missing. */
  canProceedWithStart: () => Promise<boolean>;
  /** Called when a start attempt is denied specifically at PTT-gesture time
   * (mirrors the original's handlePermissionOutcome denial tail: re-checks
   * mic permission and either surfaces the permission notification or a
   * generic "Microphone access needed" toast). */
  onMicPermissionDenied: () => void | Promise<void>;
  pushTrace?: (msg: string) => void;
}

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

export function usePttGestures({
  trans,
  pillDispatch,
  canProceedWithStart,
  onMicPermissionDenied,
  pushTrace,
}: UsePttGesturesOptions): void {
  const transRef = useRef(trans);
  transRef.current = trans;

  const pillDispatchRef = useRef(pillDispatch);
  pillDispatchRef.current = pillDispatch;

  const canProceedWithStartRef = useRef(canProceedWithStart);
  canProceedWithStartRef.current = canProceedWithStart;

  const onMicPermissionDeniedRef = useRef(onMicPermissionDenied);
  onMicPermissionDeniedRef.current = onMicPermissionDenied;

  const pushTraceRef = useRef(pushTrace);
  pushTraceRef.current = pushTrace;

  const trace = (msg: string) => pushTraceRef.current?.(msg);

  // --- gesture machine state (imperative, mirrors the old ref soup) ---
  const stateRef = useRef<GestureMachineState>(createInitialGestureState());
  const holdTimerHandleRef = useRef<NodeJS.Timeout | null>(null);
  const doubleTapTimerHandleRef = useRef<NodeJS.Timeout | null>(null);

  // --- permission pre-check plumbing (ported from beginPermissionCheck /
  // snapshotPermissionGuard / handlePermissionOutcome) ---
  const permissionCheckNonceRef = useRef(0);
  const permissionCheckStateRef = useRef<{
    token: number | null;
    result: boolean | null;
  }>({ token: null, result: null });
  const permissionCheckPromiseRef = useRef<Promise<boolean> | null>(null);

  const beginPermissionCheck = () => {
    const nextToken = permissionCheckNonceRef.current + 1;
    permissionCheckNonceRef.current = nextToken;
    permissionCheckStateRef.current = { token: nextToken, result: null };
    const promise = canProceedWithStartRef.current();
    permissionCheckPromiseRef.current = promise;
    promise
      .then((allowed) => {
        if (permissionCheckStateRef.current.token === nextToken) {
          permissionCheckStateRef.current = { token: nextToken, result: allowed };
        }
        return allowed;
      })
      .catch(() => {
        if (permissionCheckStateRef.current.token === nextToken) {
          permissionCheckStateRef.current = { token: nextToken, result: null };
        }
      });
    return { token: nextToken, promise };
  };

  const snapshotPermissionGuard = () => {
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
  };

  // Forward declaration via ref so executeStartCapture can call back into
  // dispatchGesture without a circular const definition.
  const dispatchGestureRef = useRef<(event: GestureEvent) => GestureEffect[]>(
    () => [],
  );

  const handlePermissionOutcome = (
    allowed: boolean,
    tokenId: number,
    permissionToken: number | null,
  ) => {
    if (
      permissionToken != null &&
      permissionCheckStateRef.current.token !== permissionToken
    ) {
      return;
    }
    if (allowed) return;
    const effects = dispatchGestureRef.current({
      type: "captureRejected",
      token: tokenId,
      reason: "denied",
    });
    const acted = effects.some((e) => e.type === "dispatchCancel");
    if (acted) {
      trace(`PTT capture denied (token=${tokenId})`);
      void onMicPermissionDeniedRef.current();
    }
  };

  const attachPermissionPromise = (
    permissionPromise: Promise<boolean> | null | undefined,
    tokenId: number,
    permissionToken: number | null,
  ) => {
    if (!permissionPromise) {
      handlePermissionOutcome(true, tokenId, permissionToken);
      return;
    }
    permissionPromise
      .then((allowed) => handlePermissionOutcome(allowed, tokenId, permissionToken))
      .catch(() => handlePermissionOutcome(true, tokenId, permissionToken));
  };

  const executeStartCapture = (token: number) => {
    const { permissionToken, permissionResult, permissionPromise } =
      snapshotPermissionGuard();

    if (permissionResult === false) {
      handlePermissionOutcome(false, token, permissionToken);
      return;
    }

    let startResult: void | Promise<void>;
    try {
      startResult = transRef.current.start();
    } catch (err) {
      trace(
        `PTT start failed synchronously: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      pillDispatchRef.current({ type: "CANCEL" });
      dispatchGestureRef.current({
        type: "captureRejected",
        token,
        reason: "error",
      });
      return;
    }

    Promise.resolve(startResult)
      .then(() => {
        dispatchGestureRef.current({ type: "captureStarted", token });
      })
      .catch((err) => {
        trace(
          `PTT start failed for token=${token}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        dispatchGestureRef.current({
          type: "captureRejected",
          token,
          reason: "error",
        });
      });

    if (permissionResult === true) {
      handlePermissionOutcome(true, token, permissionToken);
      return;
    }
    attachPermissionPromise(permissionPromise, token, permissionToken);
  };

  const executeEffects = (effects: GestureEffect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case "armHoldTimer": {
          if (holdTimerHandleRef.current) {
            clearTimeout(holdTimerHandleRef.current);
          }
          const timerToken = effect.timerToken;
          holdTimerHandleRef.current = setTimeout(() => {
            holdTimerHandleRef.current = null;
            dispatchGestureRef.current({ type: "holdTimerFired", timerToken });
          }, effect.ms);
          break;
        }
        case "clearHoldTimer":
          if (holdTimerHandleRef.current) {
            clearTimeout(holdTimerHandleRef.current);
            holdTimerHandleRef.current = null;
          }
          break;
        case "armDoubleTapTimer":
          if (doubleTapTimerHandleRef.current) {
            clearTimeout(doubleTapTimerHandleRef.current);
          }
          doubleTapTimerHandleRef.current = setTimeout(() => {
            doubleTapTimerHandleRef.current = null;
            dispatchGestureRef.current({ type: "doubleTapWindowExpired" });
          }, effect.ms);
          break;
        case "clearDoubleTapTimer":
          if (doubleTapTimerHandleRef.current) {
            clearTimeout(doubleTapTimerHandleRef.current);
            doubleTapTimerHandleRef.current = null;
          }
          break;
        case "playStartCue":
          try {
            playToggleOn();
          } catch {}
          break;
        case "dispatchPttStart":
          trace("PTT start");
          pillDispatchRef.current({ type: "PTT_START" });
          break;
        case "dispatchPttStop":
          trace("PTT stop");
          pillDispatchRef.current({ type: "PTT_STOP" });
          break;
        case "dispatchCancel":
          trace("PTT cancel");
          pillDispatchRef.current({ type: "CANCEL" });
          break;
        case "startCapture":
          trace(`PTT capture start (${effect.kind}) token=${effect.token}`);
          executeStartCapture(effect.token);
          break;
        case "stopCapture":
          try {
            transRef.current.stop();
          } catch {}
          break;
        case "cancelCapture":
          try {
            transRef.current.cancel();
          } catch {}
          break;
        case "notifyBusy":
          try {
            window.notifications?.send?.("Still transcribing… wait a sec");
          } catch {}
          break;
      }
    }
  };

  const dispatchGesture = (event: GestureEvent): GestureEffect[] => {
    const result = transition(stateRef.current, event);
    stateRef.current = result.state;
    executeEffects(result.effects);
    return result.effects;
  };
  dispatchGestureRef.current = dispatchGesture;

  useEffect(() => {
    if (!window.ptt?.onDown || !window.ptt?.onUp) return;

    const handleFunctionKeyDown = () => {
      trace("PTT down");
      const processing = transRef.current.processing;
      const recording = transRef.current.recording;
      if (!processing && !recording && !stateRef.current.keyDown) {
        beginPermissionCheck();
      }
      dispatchGesture({ type: "keyDown", processing, recording });
    };

    const handleFunctionKeyUp = () => {
      trace("PTT up");
      dispatchGesture({
        type: "keyUp",
        now: Date.now(),
        recording: transRef.current.recording,
      });
    };

    const throttledKeyDown = leadingThrottle(handleFunctionKeyDown, 25);
    const throttledKeyUp = leadingThrottle(handleFunctionKeyUp, 25);
    const cleanupOnDown = window.ptt.onDown(throttledKeyDown);
    const cleanupOnUp = window.ptt.onUp(throttledKeyUp);

    return () => {
      cleanupOnDown();
      cleanupOnUp();
      if (holdTimerHandleRef.current) {
        clearTimeout(holdTimerHandleRef.current);
        holdTimerHandleRef.current = null;
      }
      if (doubleTapTimerHandleRef.current) {
        clearTimeout(doubleTapTimerHandleRef.current);
        doubleTapTimerHandleRef.current = null;
      }
    };
    // Intentionally empty: all collaborators are read via refs so this
    // effect subscribes exactly once, matching the original's behavior.
  }, []);

  // Global cancel signal (Right Command via native helper).
  useEffect(() => {
    const onCancel = () => {
      const wasRecording = transRef.current.recording;
      const wasProcessing = transRef.current.processing;
      dispatchGesture({ type: "externalCancel", wasRecording, wasProcessing });
      if (wasRecording) trace("PTT cancel (recording)");
      else if (wasProcessing) trace("PTT cancel (processing)");
    };
    const cleanup = window.ptt?.onCancel
      ? window.ptt.onCancel(onCancel)
      : undefined;
    return () => {
      cleanup?.();
    };
  }, []);
}
