import { useReducer } from "react";

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
  | { type: "NOTIFY"; msg: string; actionId?: string | null }
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
    pendingNotifAction?: string | null;
    notifMsg?: string;
    notifAction?: string | null;
  };
}

// Reducer function for pill machine
export const pillReducer = (
  state: PillMachineState,
  event: PillEvent,
): PillMachineState => {
  switch (state.state) {
    case "IDLE":
      if (event.type === "PTT_START") return { ...state, state: "LISTENING" };
      if (event.type === "NOTIFY")
        return {
          state: "NOTIFICATION",
          context: {
            ...state.context,
            notifMsg: event.msg,
            notifAction: event.actionId ?? null,
            pendingNotif: undefined,
            pendingNotifAction: undefined,
          },
        };
      if (event.type === "HOVER_ENTER")
        return { ...state, state: "HOVER_PREVIEW" };
      if (event.type === "EXPAND") return { ...state, state: "EXPANDED" };
      return state;
    case "LISTENING":
      if (event.type === "PTT_STOP") return { ...state, state: "PROCESSING" };
      if (event.type === "CANCEL") return { ...state, state: "IDLE" };
      if (event.type === "NOTIFY") {
        if (isUrgentNotification(event.msg)) {
          // Cancel listening and show error notification immediately
          return {
            state: "NOTIFICATION",
            context: {
              ...state.context,
              notifMsg: event.msg,
              notifAction: event.actionId ?? null,
              pendingNotif: undefined,
              pendingNotifAction: undefined,
            },
          };
        }

        // For non-error notifications, queue them for after processing
        return {
          ...state,
          context: {
            ...state.context,
            pendingNotif: event.msg,
            pendingNotifAction: event.actionId ?? null,
          },
        };
      }
      return state;
    case "PROCESSING":
      if (event.type === "CANCEL") return { ...state, state: "IDLE" };
      if (event.type === "PROCESSING_COMPLETE") {
        if (state.context.pendingNotif) {
          return {
            state: "NOTIFICATION",
            context: {
              notifMsg: state.context.pendingNotif,
              notifAction: state.context.pendingNotifAction ?? null,
              pendingNotif: undefined,
              pendingNotifAction: undefined,
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
          context: {
            ...state.context,
            pendingNotif: state.context.notifMsg,
            pendingNotifAction: state.context.notifAction ?? null,
          },
        };
      if (event.type === "ANIM_DONE")
        return {
          ...state,
          state: "IDLE",
          context: {
            ...state.context,
            notifMsg: undefined,
            notifAction: undefined,
          },
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
      // Handle NOTIFY while expanded (e.g., sign-out from settings panel)
      // Collapse first, then show notification
      if (event.type === "NOTIFY")
        return {
          state: "NOTIFICATION",
          context: {
            ...state.context,
            notifMsg: event.msg,
            notifAction: event.actionId ?? null,
          },
        };
      return state;
    default:
      return state;
  }
};

function isUrgentNotification(message: string) {
  const normalized = message.toLowerCase();
  return [
    "required",
    "failed",
    "error",
    "expired",
    "unavailable",
    "not downloaded",
  ].some((keyword) => normalized.includes(keyword));
}

export const usePillMachine = () => {
  const [machine, dispatch] = useReducer(
    (state: PillMachineState, event: PillEvent) => {
      return pillReducer(state, event);
    },
    { state: "IDLE", context: {} },
  );
  return { state: machine.state, context: machine.context, dispatch };
};
