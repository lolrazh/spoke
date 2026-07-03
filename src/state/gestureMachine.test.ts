import { describe, it, expect } from "vitest";
import {
  transition,
  createInitialGestureState,
  type GestureMachineState,
  type GestureEvent,
  type GestureEffect,
} from "./gestureMachine";
import { HOLD_DURATION_MS, DOUBLE_TAP_MS } from "../constants/gestures";

/** Runs a sequence of events through the machine, returning the final state
 * and a flat log of every effect emitted along the way. */
function run(
  events: GestureEvent[],
  initial: GestureMachineState = createInitialGestureState(),
): { state: GestureMachineState; effectsByStep: GestureEffect[][] } {
  let state = initial;
  const effectsByStep: GestureEffect[][] = [];
  for (const event of events) {
    const result = transition(state, event);
    state = result.state;
    effectsByStep.push(result.effects);
  }
  return { state, effectsByStep };
}

function types(effects: GestureEffect[]): string[] {
  return effects.map((e) => e.type);
}

describe("gestureMachine", () => {
  describe("quick tap (released before hold threshold)", () => {
    it("arms the double-tap window and never starts a capture", () => {
      const { state, effectsByStep } = run([
        { type: "keyDown", processing: false, recording: false },
        { type: "keyUp", now: 1000, recording: false },
      ]);
      // keyDown arms the hold timer only.
      expect(types(effectsByStep[0])).toEqual(["armHoldTimer"]);
      // keyUp before the hold timer fires clears it and opens the
      // double-tap window.
      expect(types(effectsByStep[1])).toEqual([
        "clearHoldTimer",
        "armDoubleTapTimer",
      ]);
      expect(state.pendingTapAt).toBe(1000);
      expect(state.session).toBeNull();
    });

    it("a stale holdTimerFired that arrives after the quick release is a no-op", () => {
      const { state: afterDown } = run([
        { type: "keyDown", processing: false, recording: false },
      ]);
      const timerToken = afterDown.holdTimerToken!;
      const { state: afterUp } = run(
        [{ type: "keyUp", now: 1000, recording: false }],
        afterDown,
      );
      const result = transition(afterUp, {
        type: "holdTimerFired",
        timerToken,
      });
      expect(result.effects).toEqual([]);
      expect(result.state).toBe(afterUp);
    });

    it("a holdTimerFired with a mismatched (superseded) token is a no-op", () => {
      const { state } = run([
        { type: "keyDown", processing: false, recording: false },
      ]);
      const result = transition(state, {
        type: "holdTimerFired",
        timerToken: state.holdTimerToken! + 999,
      });
      expect(result.effects).toEqual([]);
    });
  });

  describe("hold and release", () => {
    it("starts a hold capture once the timer fires, and stops on release", () => {
      const { state: s1, effectsByStep: e1 } = run([
        { type: "keyDown", processing: false, recording: false },
      ]);
      const timerToken = s1.holdTimerToken!;

      const { state: s2, effectsByStep: e2 } = run(
        [{ type: "holdTimerFired", timerToken }],
        s1,
      );
      expect(types(e2[0])).toEqual([
        "playStartCue",
        "dispatchPttStart",
        "startCapture",
      ]);
      const startEffect = e2[0].find((e) => e.type === "startCapture") as Extract<
        GestureEffect,
        { type: "startCapture" }
      >;
      expect(startEffect.kind).toBe("hold");
      expect(s2.session).toEqual({
        token: startEffect.token,
        kind: "hold",
        phase: "starting",
      });
      expect(s2.isLongPress).toBe(true);

      const { state: s3, effectsByStep: e3 } = run(
        [{ type: "captureStarted", token: startEffect.token }],
        s2,
      );
      expect(e3[0]).toEqual([]);
      expect(s3.session?.phase).toBe("active");

      const { state: s4, effectsByStep: e4 } = run(
        [{ type: "keyUp", now: 5000, recording: true }],
        s3,
      );
      expect(types(e4[0])).toEqual(["stopCapture", "dispatchPttStop"]);
      expect(s4.session).toBeNull();
      expect(s4.isLongPress).toBe(false);
      void e1;
    });

    it("respects the configured HOLD_DURATION_MS / DOUBLE_TAP_MS constants", () => {
      const { state } = run([
        { type: "keyDown", processing: false, recording: false },
      ]);
      const armEffect = transition(createInitialGestureState(), {
        type: "keyDown",
        processing: false,
        recording: false,
      }).effects[0] as Extract<GestureEffect, { type: "armHoldTimer" }>;
      expect(armEffect.ms).toBe(HOLD_DURATION_MS);
      void state;
    });
  });

  describe("double-tap toggle on / off", () => {
    it("starts a hands-free capture on the second tap of a pair", () => {
      // Tap 1: down, quick up -> arms double-tap window.
      const { state: s1 } = run([
        { type: "keyDown", processing: false, recording: false },
        { type: "keyUp", now: 1000, recording: false },
      ]);
      expect(s1.pendingTapAt).toBe(1000);

      // Tap 2, well within DOUBLE_TAP_MS: down, up -> starts doubleTap capture.
      const { state: s2, effectsByStep } = run(
        [
          { type: "keyDown", processing: false, recording: false },
          {
            type: "keyUp",
            now: 1000 + DOUBLE_TAP_MS - 1,
            recording: false,
          },
        ],
        s1,
      );
      const upEffects = effectsByStep[1];
      expect(types(upEffects)).toEqual([
        "clearHoldTimer",
        "clearDoubleTapTimer",
        "playStartCue",
        "dispatchPttStart",
        "startCapture",
      ]);
      const startEffect = upEffects.find(
        (e) => e.type === "startCapture",
      ) as Extract<GestureEffect, { type: "startCapture" }>;
      expect(startEffect.kind).toBe("doubleTap");
      expect(s2.pendingTapAt).toBeNull();
      expect(s2.session?.kind).toBe("doubleTap");

      const { state: s3 } = run(
        [{ type: "captureStarted", token: startEffect.token }],
        s2,
      );
      expect(s3.session?.phase).toBe("active");
    });

    it("stops hands-free capture on a second double-tap pair while recording", () => {
      // Get into an active hands-free capture first.
      let state = createInitialGestureState();
      ({ state } = run(
        [
          { type: "keyDown", processing: false, recording: false },
          { type: "keyUp", now: 1000, recording: false },
          { type: "keyDown", processing: false, recording: false },
          { type: "keyUp", now: 1000 + 100, recording: false },
        ],
        state,
      ));
      const activeToken = state.session!.token;
      ({ state } = run(
        [{ type: "captureStarted", token: activeToken }],
        state,
      ));
      expect(state.session).toEqual({
        token: activeToken,
        kind: "doubleTap",
        phase: "active",
      });

      // A single tap while hands-free is active does NOT stop it — it's
      // just the first tap of a new pair (mirrors the original: lastTapUpRef
      // is null right after starting, so the very next tap only re-arms the
      // window).
      const beforeThirdTap = state;
      ({ state } = run(
        [
          { type: "keyDown", processing: false, recording: true },
          { type: "keyUp", now: 5000, recording: true },
        ],
        state,
      ));
      expect(state.session).toEqual(beforeThirdTap.session);
      expect(state.pendingTapAt).toBe(5000);

      // The second tap of THIS pair, still recording, finally stops it.
      const { effectsByStep } = run(
        [
          { type: "keyDown", processing: false, recording: true },
          { type: "keyUp", now: 5000 + 50, recording: true },
        ],
        state,
      );
      const upEffects = effectsByStep[1];
      expect(types(upEffects)).toEqual([
        "clearDoubleTapTimer",
        "stopCapture",
        "dispatchPttStop",
      ]);
    });

    it("cancels a not-yet-started hands-free capture if a fresh double-tap pair arrives first", () => {
      // Note: this requires a whole SECOND tap-pair, not just one more tap —
      // starting a doubleTap capture always resets the double-tap window
      // (pendingTapAt -> null), so a lone third tap is just the first tap of
      // a new pair. Only if a fourth tap then falls within that new pair's
      // window (while the original capture is still unresolved) does the
      // "cancel before activation" branch fire. This mirrors the original's
      // lastTapUpRef being nulled unconditionally when a doubleTap starts.
      let state = createInitialGestureState();
      ({ state } = run(
        [
          { type: "keyDown", processing: false, recording: false },
          { type: "keyUp", now: 1000, recording: false },
          { type: "keyDown", processing: false, recording: false },
          { type: "keyUp", now: 1000 + 100, recording: false },
        ],
        state,
      ));
      expect(state.session?.kind).toBe("doubleTap");
      expect(state.session?.phase).toBe("starting");

      // Third tap: just re-arms a fresh double-tap window.
      ({ state } = run(
        [
          { type: "keyDown", processing: false, recording: false },
          { type: "keyUp", now: 1000 + 150, recording: false },
        ],
        state,
      ));
      expect(state.pendingTapAt).toBe(1000 + 150);
      expect(state.session?.phase).toBe("starting");

      // Fourth tap, within the new window, while the original capture is
      // still unresolved: this is the one that cancels it.
      const { state: s2, effectsByStep } = run(
        [
          { type: "keyDown", processing: false, recording: false },
          { type: "keyUp", now: 1000 + 200, recording: false },
        ],
        state,
      );
      const upEffects = effectsByStep[1];
      expect(types(upEffects)).toEqual([
        "clearHoldTimer",
        "clearDoubleTapTimer",
        "cancelCapture",
        "dispatchCancel",
      ]);
      expect(s2.session).toBeNull();

      // The original start's eventual resolution (captureStarted) must be a
      // pure no-op now — nothing was scheduled for it, and it's no longer
      // the current session.
      const late = transition(s2, {
        type: "captureStarted",
        token: state.session!.token,
      });
      expect(late.effects).toEqual([]);
      expect(late.state).toBe(s2);
    });

    it("double-tap window expiring naturally means the next tap starts a fresh window, not a toggle", () => {
      const { state: s1 } = run([
        { type: "keyDown", processing: false, recording: false },
        { type: "keyUp", now: 1000, recording: false },
      ]);
      const { state: s2 } = run(
        [{ type: "doubleTapWindowExpired" }],
        s1,
      );
      expect(s2.pendingTapAt).toBeNull();

      const { state: s3, effectsByStep } = run(
        [
          { type: "keyDown", processing: false, recording: false },
          { type: "keyUp", now: 1000 + DOUBLE_TAP_MS + 500, recording: false },
        ],
        s2,
      );
      // Treated as a brand new first tap, not a toggle.
      expect(types(effectsByStep[1])).toEqual([
        "clearHoldTimer",
        "armDoubleTapTimer",
      ]);
      expect(s3.session).toBeNull();
    });
  });

  describe("cancel mid-hold (external cancel signal)", () => {
    it("cancels an actively-recording hold capture immediately", () => {
      let state = createInitialGestureState();
      ({ state } = run(
        [{ type: "keyDown", processing: false, recording: false }],
        state,
      ));
      const timerToken = state.holdTimerToken!;
      ({ state } = run([{ type: "holdTimerFired", timerToken }], state));
      const token = state.session!.token;
      ({ state } = run([{ type: "captureStarted", token }], state));
      expect(state.session?.phase).toBe("active");

      const { state: afterCancel, effectsByStep } = run(
        [{ type: "externalCancel", wasRecording: true, wasProcessing: false }],
        state,
      );
      expect(types(effectsByStep[0])).toEqual([
        "cancelCapture",
        "dispatchCancel",
      ]);
      expect(afterCancel.isLongPress).toBe(true);
      // Quirk preserved from the original: activeCaptureRef (session) is
      // deliberately left untouched by the cancel signal itself.
      expect(afterCancel.session).toEqual({ token, kind: "hold", phase: "active" });

      // The eventual key-up now takes the long-press conclusion branch
      // (isLongPress was forced true) and, since recording is now false
      // (the cancel already stopped it), schedules a redundant cancel
      // rather than stopping again.
      const { effectsByStep: upEffects, state: afterUp } = run(
        [{ type: "keyUp", now: 9000, recording: false }],
        afterCancel,
      );
      expect(types(upEffects[0])).toEqual(["dispatchCancel"]);
      expect(afterUp.pendingPostStartActions[token]).toBe("cancel");
      // Session is still left dangling (never observably reused: no future
      // captureStarted/captureRejected for this token will ever arrive
      // since it already resolved earlier).
      expect(afterUp.session).toEqual({ token, kind: "hold", phase: "active" });
    });

    it("does not dispatch cancel when neither recording nor processing was active", () => {
      const { effectsByStep, state } = run([
        { type: "externalCancel", wasRecording: false, wasProcessing: false },
      ]);
      expect(effectsByStep[0]).toEqual([]);
      expect(state.isLongPress).toBe(true);
    });

    it("cancels while processing (post-hold, pre-completion) too", () => {
      const { effectsByStep } = run([
        { type: "externalCancel", wasRecording: false, wasProcessing: true },
      ]);
      expect(types(effectsByStep[0])).toEqual([
        "cancelCapture",
        "dispatchCancel",
      ]);
    });

    it("clears any armed hold/double-tap timers", () => {
      const { state: afterDown } = run([
        { type: "keyDown", processing: false, recording: false },
      ]);
      const { effectsByStep } = run(
        [{ type: "externalCancel", wasRecording: false, wasProcessing: false }],
        afterDown,
      );
      expect(types(effectsByStep[0])).toContain("clearHoldTimer");
    });
  });

  describe("key-up racing the async capture start", () => {
    it("defers the cancel for a hold capture until the start resolves", () => {
      let state = createInitialGestureState();
      ({ state } = run(
        [{ type: "keyDown", processing: false, recording: false }],
        state,
      ));
      const timerToken = state.holdTimerToken!;
      ({ state } = run([{ type: "holdTimerFired", timerToken }], state));
      const token = state.session!.token;
      expect(state.session?.phase).toBe("starting");

      // Key released before the async start resolves.
      const { state: afterUp, effectsByStep } = run(
        [{ type: "keyUp", now: 2000, recording: false }],
        state,
      );
      expect(types(effectsByStep[0])).toEqual(["dispatchCancel"]);
      expect(afterUp.pendingPostStartActions[token]).toBe("cancel");
      // Session is intentionally NOT cleared yet — the decision is deferred.
      expect(afterUp.session).toEqual({ token, kind: "hold", phase: "starting" });

      // The async start now resolves successfully; the deferred cancel fires.
      const { state: afterStart, effectsByStep: startEffects } = run(
        [{ type: "captureStarted", token }],
        afterUp,
      );
      expect(types(startEffects[0])).toEqual([
        "cancelCapture",
        "dispatchCancel",
      ]);
      expect(afterStart.session).toBeNull();
      expect(afterStart.pendingPostStartActions[token]).toBeUndefined();
    });

    it("discards the deferred action if the start fails instead", () => {
      let state = createInitialGestureState();
      ({ state } = run(
        [{ type: "keyDown", processing: false, recording: false }],
        state,
      ));
      const timerToken = state.holdTimerToken!;
      ({ state } = run([{ type: "holdTimerFired", timerToken }], state));
      const token = state.session!.token;
      ({ state } = run([{ type: "keyUp", now: 2000, recording: false }], state));
      expect(state.pendingPostStartActions[token]).toBe("cancel");

      const { state: afterFail, effectsByStep } = run(
        [{ type: "captureRejected", token, reason: "error" }],
        state,
      );
      // No stopCapture/cancelCapture call, no dispatch — nothing to undo.
      expect(effectsByStep[0]).toEqual([]);
      expect(afterFail.session).toBeNull();
      expect(afterFail.pendingPostStartActions[token]).toBeUndefined();
    });

    it("a synchronous-style captureRejected('error') before any key-up just clears bookkeeping without dispatching", () => {
      let state = createInitialGestureState();
      ({ state } = run(
        [{ type: "keyDown", processing: false, recording: false }],
        state,
      ));
      const timerToken = state.holdTimerToken!;
      ({ state } = run([{ type: "holdTimerFired", timerToken }], state));
      const token = state.session!.token;

      const result = transition(state, {
        type: "captureRejected",
        token,
        reason: "error",
      });
      expect(result.effects).toEqual([]);
      expect(result.state.session).toBeNull();
    });
  });

  describe("permission denial races", () => {
    it("cancels an in-flight hold while the key is still down, and falls back to tap classification on release", () => {
      let state = createInitialGestureState();
      ({ state } = run(
        [{ type: "keyDown", processing: false, recording: false }],
        state,
      ));
      const timerToken = state.holdTimerToken!;
      ({ state } = run([{ type: "holdTimerFired", timerToken }], state));
      const token = state.session!.token;
      expect(state.isLongPress).toBe(true);
      expect(state.keyDown).toBe(true);

      const { state: afterDenied, effectsByStep } = run(
        [{ type: "captureRejected", token, reason: "denied" }],
        state,
      );
      expect(types(effectsByStep[0])).toEqual([
        "cancelCapture",
        "dispatchCancel",
      ]);
      expect(afterDenied.session).toBeNull();
      // isLongPress reset to false for a denied hold — the key is still
      // down, so the eventual release is treated as a tap for double-tap
      // sequencing purposes, matching the original.
      expect(afterDenied.isLongPress).toBe(false);
      expect(afterDenied.keyDown).toBe(true);

      const { effectsByStep: upEffects } = run(
        [{ type: "keyUp", now: 9999, recording: false }],
        afterDenied,
      );
      expect(types(upEffects[0])).toEqual(["armDoubleTapTimer"]);
    });

    it("is a no-op once the key has already been released for that gesture", () => {
      let state = createInitialGestureState();
      ({ state } = run(
        [{ type: "keyDown", processing: false, recording: false }],
        state,
      ));
      const timerToken = state.holdTimerToken!;
      ({ state } = run([{ type: "holdTimerFired", timerToken }], state));
      const token = state.session!.token;
      ({ state } = run([{ type: "keyUp", now: 2000, recording: false }], state));
      expect(state.pendingPostStartActions[token]).toBe("cancel");

      const result = transition(state, {
        type: "captureRejected",
        token,
        reason: "denied",
      });
      expect(result.effects).toEqual([]);
      // The scheduled action must be left completely untouched.
      expect(result.state).toBe(state);
      expect(result.state.pendingPostStartActions[token]).toBe("cancel");
    });

    it("is a no-op for an unrelated/superseded token", () => {
      const state = createInitialGestureState();
      const result = transition(state, {
        type: "captureRejected",
        token: 42,
        reason: "denied",
      });
      expect(result.effects).toEqual([]);
      expect(result.state).toBe(state);
    });
  });

  describe("rapid re-press while transcription is busy (processing)", () => {
    it("keyDown while processing notifies without arming anything, and leaves keyDown false", () => {
      const { state, effectsByStep } = run([
        { type: "keyDown", processing: true, recording: false },
      ]);
      expect(types(effectsByStep[0])).toEqual(["notifyBusy"]);
      expect(state.keyDown).toBe(false);
      expect(state.holdTimerToken).toBeNull();
      expect(state.session).toBeNull();
    });

    it("the eventual key-up for a busy-rejected press is ignored, clearing any open double-tap window", () => {
      // Open a double-tap window from an earlier completed tap.
      let state = createInitialGestureState();
      ({ state } = run(
        [
          { type: "keyDown", processing: false, recording: false },
          { type: "keyUp", now: 1000, recording: false },
        ],
        state,
      ));
      expect(state.pendingTapAt).toBe(1000);

      ({ state } = run(
        [{ type: "keyDown", processing: true, recording: false }],
        state,
      ));

      const { effectsByStep, state: afterUp } = run(
        [{ type: "keyUp", now: 1100, recording: false }],
        state,
      );
      expect(types(effectsByStep[0])).toEqual(["clearDoubleTapTimer"]);
      expect(afterUp.pendingTapAt).toBeNull();
    });

    it("repeated busy key-downs notify every time (no 'already active' suppression)", () => {
      const { effectsByStep } = run([
        { type: "keyDown", processing: true, recording: false },
        { type: "keyUp", now: 1, recording: false },
        { type: "keyDown", processing: true, recording: false },
      ]);
      expect(types(effectsByStep[0])).toEqual(["notifyBusy"]);
      expect(types(effectsByStep[2])).toEqual(["notifyBusy"]);
    });
  });

  describe("keyDown guard against duplicate/repeat events", () => {
    it("ignores a second keyDown while already down", () => {
      const { state, effectsByStep } = run([
        { type: "keyDown", processing: false, recording: false },
        { type: "keyDown", processing: false, recording: false },
      ]);
      expect(effectsByStep[1]).toEqual([]);
      expect(state.holdTimerToken).not.toBeNull();
    });

    it("keyDown while a hands-free capture is already recording does not arm a hold timer", () => {
      const { state, effectsByStep } = run([
        { type: "keyDown", processing: false, recording: true },
      ]);
      expect(effectsByStep[0]).toEqual([]);
      expect(state.keyDown).toBe(true);
      expect(state.holdTimerToken).toBeNull();
    });
  });
});
