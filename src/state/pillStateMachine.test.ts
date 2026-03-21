import { describe, it, expect } from "vitest";
import {
  pillReducer,
  type PillMachineState,
  type PillEvent,
} from "./pillStateMachine";

const idle: PillMachineState = { state: "IDLE", context: {} };

function dispatch(state: PillMachineState, event: PillEvent): PillMachineState {
  return pillReducer(state, event);
}

describe("pillStateMachine", () => {
  describe("IDLE state", () => {
    it("transitions to LISTENING on PTT_START", () => {
      expect(dispatch(idle, { type: "PTT_START" }).state).toBe("LISTENING");
    });

    it("transitions to NOTIFICATION on NOTIFY", () => {
      const next = dispatch(idle, { type: "NOTIFY", msg: "hello" });
      expect(next.state).toBe("NOTIFICATION");
      expect(next.context.notifMsg).toBe("hello");
    });

    it("transitions to HOVER_PREVIEW on HOVER_ENTER", () => {
      expect(dispatch(idle, { type: "HOVER_ENTER" }).state).toBe(
        "HOVER_PREVIEW",
      );
    });

    it("transitions to EXPANDED on EXPAND", () => {
      expect(dispatch(idle, { type: "EXPAND" }).state).toBe("EXPANDED");
    });

    it("ignores unhandled events", () => {
      expect(dispatch(idle, { type: "PTT_STOP" }).state).toBe("IDLE");
      expect(dispatch(idle, { type: "CANCEL" }).state).toBe("IDLE");
      expect(dispatch(idle, { type: "ANIM_DONE" }).state).toBe("IDLE");
    });
  });

  describe("LISTENING state", () => {
    const listening: PillMachineState = { state: "LISTENING", context: {} };

    it("transitions to PROCESSING on PTT_STOP", () => {
      expect(dispatch(listening, { type: "PTT_STOP" }).state).toBe(
        "PROCESSING",
      );
    });

    it("transitions to IDLE on CANCEL", () => {
      expect(dispatch(listening, { type: "CANCEL" }).state).toBe("IDLE");
    });

    it("queues non-error notifications for after processing", () => {
      const next = dispatch(listening, {
        type: "NOTIFY",
        msg: "just a note",
      });
      expect(next.state).toBe("LISTENING");
      expect(next.context.pendingNotif).toBe("just a note");
    });

    it("shows error notifications immediately", () => {
      const next = dispatch(listening, {
        type: "NOTIFY",
        msg: "Subscription expired",
      });
      expect(next.state).toBe("NOTIFICATION");
      expect(next.context.notifMsg).toBe("Subscription expired");
    });

    it("detects error keywords in notifications", () => {
      const errorMsgs = [
        "Permission required",
        "Auth failed",
        "Connection error",
        "Token expired",
        "Upgrade needed",
        "Sign in to continue",
        "Out of free words",
      ];
      for (const msg of errorMsgs) {
        const next = dispatch(listening, { type: "NOTIFY", msg });
        expect(next.state).toBe("NOTIFICATION");
      }
    });
  });

  describe("PROCESSING state", () => {
    const processing: PillMachineState = { state: "PROCESSING", context: {} };

    it("transitions to IDLE on PROCESSING_COMPLETE (no pending)", () => {
      expect(dispatch(processing, { type: "PROCESSING_COMPLETE" }).state).toBe(
        "IDLE",
      );
    });

    it("transitions to NOTIFICATION on PROCESSING_COMPLETE with pending", () => {
      const withPending: PillMachineState = {
        state: "PROCESSING",
        context: { pendingNotif: "queued msg" },
      };
      const next = dispatch(withPending, { type: "PROCESSING_COMPLETE" });
      expect(next.state).toBe("NOTIFICATION");
      expect(next.context.notifMsg).toBe("queued msg");
      expect(next.context.pendingNotif).toBeUndefined();
    });

    it("transitions to IDLE on CANCEL", () => {
      expect(dispatch(processing, { type: "CANCEL" }).state).toBe("IDLE");
    });
  });

  describe("NOTIFICATION state", () => {
    const notification: PillMachineState = {
      state: "NOTIFICATION",
      context: { notifMsg: "hello" },
    };

    it("transitions to IDLE on ANIM_DONE and clears message", () => {
      const next = dispatch(notification, { type: "ANIM_DONE" });
      expect(next.state).toBe("IDLE");
      expect(next.context.notifMsg).toBeUndefined();
    });

    it("transitions to LISTENING on PTT_START and queues message", () => {
      const next = dispatch(notification, { type: "PTT_START" });
      expect(next.state).toBe("LISTENING");
      expect(next.context.pendingNotif).toBe("hello");
    });
  });

  describe("HOVER_PREVIEW state", () => {
    const hover: PillMachineState = { state: "HOVER_PREVIEW", context: {} };

    it("transitions to IDLE on HOVER_LEAVE", () => {
      expect(dispatch(hover, { type: "HOVER_LEAVE" }).state).toBe("IDLE");
    });

    it("transitions to LISTENING on PTT_START", () => {
      expect(dispatch(hover, { type: "PTT_START" }).state).toBe("LISTENING");
    });

    it("transitions to EXPANDED on EXPAND", () => {
      expect(dispatch(hover, { type: "EXPAND" }).state).toBe("EXPANDED");
    });
  });

  describe("EXPANDED state", () => {
    const expanded: PillMachineState = { state: "EXPANDED", context: {} };

    it("transitions to IDLE on COLLAPSE", () => {
      expect(dispatch(expanded, { type: "COLLAPSE" }).state).toBe("IDLE");
    });

    it("transitions to LISTENING on PTT_START", () => {
      expect(dispatch(expanded, { type: "PTT_START" }).state).toBe("LISTENING");
    });

    it("transitions to NOTIFICATION on NOTIFY", () => {
      const next = dispatch(expanded, { type: "NOTIFY", msg: "Signed out" });
      expect(next.state).toBe("NOTIFICATION");
      expect(next.context.notifMsg).toBe("Signed out");
    });
  });
});
