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
import { getSignals, setLastToastTs } from "../utils/authSignals";
import { shouldToastSignIn } from "../utils/shouldToastSignIn";

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

const SHARE_PREF_STORAGE_PREFIX = "sf.shareTranscriptions.";

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
  const [notchWidth, setNotchWidth] = useState<number | null>(null);
  const notchDecisionLogRef = useRef<string | null>(null);
  const prevUserIdRef = useRef<string | null>(null);
  const lastToastTsRef = useRef<number | null>(null);
  const lastFocusTsRef = useRef<number | null>(
    typeof performance !== "undefined" ? performance.now() : null,
  );
  const [shareTranscriptionsEnabled, setShareTranscriptionsEnabled] =
    useState<boolean>(false);
  const [shareTranscriptionsLoading, setShareTranscriptionsLoading] =
    useState<boolean>(true);
  const [shareTranscriptionsUpdating, setShareTranscriptionsUpdating] =
    useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const loadSharePreference = useCallback(async (userId: string | null) => {
    if (!userId) {
      setShareTranscriptionsEnabled(false);
      setShareTranscriptionsLoading(false);
      return;
    }

    let seeded = false;
    try {
      const stored = localStorage.getItem(
        `${SHARE_PREF_STORAGE_PREFIX}${userId}`,
      );
      if (stored != null) {
        seeded = true;
        setShareTranscriptionsEnabled(stored === "true");
      }
    } catch {}

    setShareTranscriptionsLoading(true);
    try {
      const { getShareTranscriptionsPreference } = await import(
        "../lib/supabaseClient"
      );
      const pref = await getShareTranscriptionsPreference();
      if (pref === null) {
        if (!seeded) setShareTranscriptionsEnabled(false);
      } else {
        const value = pref === true;
        setShareTranscriptionsEnabled(value);
        try {
          localStorage.setItem(
            `${SHARE_PREF_STORAGE_PREFIX}${userId}`,
            value ? "true" : "false",
          );
        } catch {}
      }
    } catch {
      if (!seeded) setShareTranscriptionsEnabled(false);
    } finally {
      setShareTranscriptionsLoading(false);
    }
  }, []);

  const handleSharePreferenceToggle = useCallback(
    async (enabled: boolean) => {
      const userId = currentUserIdRef.current;
      if (!userId) {
        try {
          window.notifications?.send?.("Sign in to change this setting");
        } catch {}
        return;
      }
      if (shareTranscriptionsUpdating) return;
      if (enabled === shareTranscriptionsEnabled) return;
      const previous = shareTranscriptionsEnabled;
      setShareTranscriptionsEnabled(enabled);
      setShareTranscriptionsUpdating(true);
      try {
        const { setShareTranscriptionsPreference } = await import(
          "../lib/supabaseClient"
        );
        const ok = await setShareTranscriptionsPreference(enabled);
        if (!ok) throw new Error("update failed");
        try {
          localStorage.setItem(
            `${SHARE_PREF_STORAGE_PREFIX}${userId}`,
            enabled ? "true" : "false",
          );
        } catch {}
      } catch {
        setShareTranscriptionsEnabled(previous);
        try {
          window.notifications?.send?.(
            "Unable to update sharing preference",
          );
        } catch {}
      } finally {
        setShareTranscriptionsUpdating(false);
      }
    },
    [shareTranscriptionsEnabled, shareTranscriptionsUpdating],
  );

  // Track focus to guard Mission Control/Spaces focus resumes
  useEffect(() => {
    const onFocus = () => {
      try {
        lastFocusTsRef.current =
          typeof performance !== "undefined" ? performance.now() : null;
      } catch {}
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
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
            latestTransRef.current?.cancel?.();
          } catch {}
          setCurrentUserId(null);
          await loadSharePreference(null);
        } else if (user) {
          try {
            await window.electron?.showFloatingBar?.();
          } catch {}
          setCurrentUserId(user.id ?? null);
          await loadSharePreference(user.id ?? null);
        } else {
          setCurrentUserId(null);
          await loadSharePreference(null);
        }
        // Seed previous user for transition detection
        try {
          prevUserIdRef.current = user?.id ?? null;
        } catch {}
        const supabase = getSupabase();
        if (supabase) {
          const {
            data: { subscription },
          } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === "SIGNED_IN" && session?.user) {
              const currentUserId = session.user.id ?? null;
              const now = Date.now();
              const signals = getSignals();
              const docHidden = typeof document !== "undefined" ? document.hidden : false;
              const msSinceFocus =
                typeof performance !== "undefined" && lastFocusTsRef.current != null
                  ? performance.now() - lastFocusTsRef.current
                  : null;
              const allow = shouldToastSignIn({
                event: "SIGNED_IN",
                prevUserId: prevUserIdRef.current,
                currentUserId,
                now,
                lastToastTs: lastToastTsRef.current,
                authIntentTs: signals.authIntentTs,
                authCallbackTs: signals.authCallbackTs,
                onboardingTs: signals.onboardingTs,
                documentHidden: docHidden,
                msSinceFocus,
                // Be a bit more conservative around focus churn (Mission Control, Spaces)
                focusGuardMs: 1200,
              });
              // Let onboarding-complete handle showing the pill and the sign-in toast.
              // Avoid triggering show here to prevent flicker on focus/Spaces.
              if (allow) {
                // Update last-toast timestamp to suppress any late duplicate triggers.
                lastToastTsRef.current = now;
                try { setLastToastTs(now); } catch {}
              }
              // Update previous after handling
              prevUserIdRef.current = currentUserId;
              setCurrentUserId(currentUserId);
              loadSharePreference(currentUserId);
              return;
            }
            if (!session?.user && !skipAuth) {
              // Guard: avoid playing signed-out sequence on cold start (no previous user)
              if (prevUserIdRef.current == null) {
                prevUserIdRef.current = null;
                setCurrentUserId(null);
                loadSharePreference(null);
                return;
              }
              (async () => {
                try {
                  // Cancel any active or in-flight transcription when signing out
                  latestTransRef.current?.cancel?.();
                } catch {}
                try { window.notifications?.send?.("Signed out"); } catch {}
                setPendingHideAfterCollapse({
                  active: true,
                  message: "Signed out",
                  onAfter: async () => {
                    try { await window.electron?.showOnboarding?.(); } catch {}
                  },
                });
              })();
              prevUserIdRef.current = null;
              setCurrentUserId(null);
              loadSharePreference(null);
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
                  // Guard: only toast sign-out on a real transition from a prior user
                  if (prevUserIdRef.current == null) return;
                  setCurrentUserId(null);
                  loadSharePreference(null);
                  try { latestTransRef.current?.cancel?.(); } catch {}
                  try { window.notifications?.send?.("Signed out"); } catch {}
                  setPendingHideAfterCollapse({
                    active: true,
                    message: "Signed out",
                    onAfter: async () => {
                      try { await window.electron?.showOnboarding?.(); } catch {}
                    },
                  });
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
  }, [loadSharePreference]);
  // Only open mic during dictation
  const trans = useTranscription({
    autoEnumerateDevices: true,
    autoInitStream: false,
    requestLabelPermissionForEnumeration: false,
    shareTranscriptionsEnabled,
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
  const isOptionDownRef = useRef(false);
  const gestureTokenCounterRef = useRef(0);
  const pendingStartTokenRef = useRef<
    { id: number; kind: "hold" | "doubleTap" }
    | null
  >(null);
  const holdActivationNonceRef = useRef<number | null>(null);
  // Prevent double-playing the start cue when long-press timer and
  // double-tap start race on first gesture after idle
  const startCuePlayedRef = useRef(false);
  const latestTransRef = useRef(trans);
  const [trace, setTrace] = useState<string[]>([]);
  const [pendingHideAfterCollapse, setPendingHideAfterCollapse] = useState<{
    active: boolean;
    message: string;
    onAfter?: () => void;
  }>({ active: false, message: "" });

  const permissionCheckNonceRef = useRef(0);
  const permissionCheckStateRef = useRef<{
    token: number | null;
    result: boolean | null;
  }>({ token: null, result: null });
  const permissionCheckPromiseRef = useRef<Promise<boolean> | null>(null);
  const activeCaptureRef = useRef<
    { token: number; kind: "hold" | "doubleTap" }
    | null
  >(null);
  const postStartActionRef = useRef<Map<number, "cancel" | "stop">>(
    new Map(),
  );
  const prevRecordingRef = useRef(trans.recording);

  const beginPermissionCheck = useCallback(() => {
    const nextToken = permissionCheckNonceRef.current + 1;
    permissionCheckNonceRef.current = nextToken;
    permissionCheckStateRef.current = { token: nextToken, result: null };
    const promise = canProceedWithStartBasedOnMicPermission();
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
  }, []);

  const pushTrace = useCallback((msg: string) => {
    setTrace((t) => [
      `${performance.now().toFixed(0)}: ${msg}`,
      ...t.slice(0, 15),
    ]);
  }, []);

  useEffect(() => {
    pushTrace(`Mode: ${trans.mode}`);
  }, [trans.mode, pushTrace]);

  useEffect(() => {
    if (!trans.selection) return;
    const snapshot = trans.selection;
    const summary = snapshot.hadSelection
      ? `Selection captured (${snapshot.selectedText?.length ?? 0} chars)`
      : `Selection inspect ${snapshot.status}`;
    pushTrace(summary);
  }, [trans.selection, pushTrace]);

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
      const notch = payload?.notch;
      const nextNotchWidth =
        notch && notch.hasNotch && notch.notchWidth > 0 ? notch.notchWidth : null;
      setNotchWidth(nextNotchWidth);
      const scaleStr = Number.isFinite(s) ? s.toFixed(3) : "?";
      const notchStr =
        nextNotchWidth && Number.isFinite(nextNotchWidth)
          ? nextNotchWidth.toFixed(2)
          : "none";
      const source = notch?.hasNotch ? "native-notch" : "fallback";
      console.log(
        `[Display] active=${payload?.id ?? "?"} scale=${scaleStr} notch=${notchStr} source=${source}`,
      );
      if (notch) {
        console.log("[Display] notch payload", {
          hasNotch: notch.hasNotch,
          notchWidth: notch.notchWidth,
          id: notch.id,
          scaleFactor: notch.scaleFactor,
        });
      }
    });
  }, []);

  const {
    state: pillState,
    context: pillContext,
    dispatch: pillDispatch,
  } = usePillMachine();

  const beginCaptureSession = useCallback(
    (token: number, kind: "hold" | "doubleTap") => {
      activeCaptureRef.current = { token, kind };
      postStartActionRef.current.delete(token);
      pushTrace(`Capture session begin (${kind}) token=${token}`);
    },
    [pushTrace],
  );

  const schedulePostStartAction = useCallback(
    (token: number, action: "cancel" | "stop") => {
      postStartActionRef.current.set(token, action);
      pushTrace(`Scheduled post-start ${action} for token=${token}`);
    },
    [pushTrace],
  );

  const clearActiveCapture = useCallback(
    (token?: number) => {
      if (typeof token === "number") {
        postStartActionRef.current.delete(token);
        if (activeCaptureRef.current?.token === token) {
          pushTrace(`Capture session cleared (${activeCaptureRef.current.kind}) token=${token}`);
          activeCaptureRef.current = null;
        }
        return;
      }
      if (activeCaptureRef.current) {
        pushTrace(
          `Capture session cleared (${activeCaptureRef.current.kind}) token=${activeCaptureRef.current.token}`,
        );
      }
      activeCaptureRef.current = null;
      postStartActionRef.current.clear();
    },
    [pushTrace],
  );

  const monitorStartResolution = useCallback(
    (
      token: number,
      kind: "hold" | "doubleTap",
      promise: Promise<unknown>,
    ) => {
      promise
        .then(() => {
          const scheduled = postStartActionRef.current.get(token);
          if (!scheduled) return;
          pushTrace(
            `Start resolved; executing scheduled ${scheduled} for ${kind} token=${token}`,
          );
          if (scheduled === "cancel") {
            try {
              latestTransRef.current.cancel();
            } catch {}
            pillDispatch({ type: "CANCEL" });
          } else {
            try {
              latestTransRef.current.stop();
            } catch {}
            pillDispatch({ type: "PTT_STOP" });
          }
          clearActiveCapture(token);
        })
        .catch((err) => {
          pushTrace(
            `Start failed for ${kind} token=${token}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          clearActiveCapture(token);
        })
        .finally(() => {
          postStartActionRef.current.delete(token);
        });
    },
    [clearActiveCapture, pillDispatch, pushTrace],
  );

  useEffect(() => {
    const wasRecording = prevRecordingRef.current;
    if (!wasRecording && trans.recording) {
      const active = activeCaptureRef.current;
      const postAction = active
        ? postStartActionRef.current.get(active.token)
        : undefined;
      if (active && postAction) {
        pushTrace(
          `Start pending scheduled ${postAction} for ${active.kind} token=${active.token}`,
        );
      } else if (active && active.kind === "hold" && !isOptionDownRef.current) {
        pushTrace("Auto-cancel hold capture after late start");
        try {
          latestTransRef.current.cancel();
        } catch {}
        pillDispatch({ type: "CANCEL" });
        clearActiveCapture(active.token);
      }
    }
    prevRecordingRef.current = trans.recording;
  }, [
    clearActiveCapture,
    pillDispatch,
    pushTrace,
    trans.recording,
  ]);

  const snapshotPermissionGuard = useCallback(
    (refresh = false) => {
      if (refresh) {
        const { token, promise } = beginPermissionCheck();
        return {
          permissionToken: token,
          permissionResult: permissionCheckStateRef.current.result,
          permissionPromise: promise,
        };
      }
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
    },
    [beginPermissionCheck],
  );

  const handlePermissionOutcome = useCallback(
    async (
      allowed: boolean,
      tokenId: number,
      kind: "hold" | "doubleTap",
      permissionToken: number | null,
    ) => {
      const pendingToken = pendingStartTokenRef.current;
      if (
        !pendingToken ||
        pendingToken.id !== tokenId ||
        pendingToken.kind !== kind
      ) {
        return;
      }
      if (
        permissionToken != null &&
        permissionCheckStateRef.current.token !== permissionToken
      ) {
        return;
      }
      if (!allowed) {
        pendingStartTokenRef.current = null;
        if (kind === "hold") {
          isLongPressRef.current = false;
        }
        try {
          latestTransRef.current.cancel();
        } catch {}
        pushTrace(`PTT ${kind} gate denied`);
        try {
          const mic = await window.electron?.checkMicrophonePermission?.();
          const msg =
            mic && mic.granted === false
              ? "Microphone permission is off. Double-click to open Settings."
              : "Sign in to dictate";
          pillDispatch({ type: "CANCEL" });
          pillDispatch({ type: "NOTIFY", msg });
        } catch {
          pillDispatch({ type: "CANCEL" });
        }
        clearActiveCapture(tokenId);
        return;
      }
      pendingStartTokenRef.current = null;
      pushTrace(`PTT ${kind} capture started`);
    },
    [clearActiveCapture, pillDispatch, pushTrace],
  );

  const attachPermissionPromise = useCallback(
    (
      permissionPromise: Promise<boolean> | null | undefined,
      tokenId: number,
      kind: "hold" | "doubleTap",
      permissionToken: number | null,
    ) => {
      if (!permissionPromise) {
        void handlePermissionOutcome(true, tokenId, kind, permissionToken);
        return;
      }
      permissionPromise
        .then((allowed) =>
          handlePermissionOutcome(allowed, tokenId, kind, permissionToken),
        )
        .catch(() =>
          handlePermissionOutcome(true, tokenId, kind, permissionToken),
        );
    },
    [handlePermissionOutcome],
  );

  useEffect(() => {
    if (!trans.recording && !trans.processing) {
      pushTrace(
        trans.text
          ? `Transcription complete: "${trans.text}"`
          : `Transcription finished (no text or failed fast)`,
      );
      pillDispatch({ type: "PROCESSING_COMPLETE" });
    }
  }, [pillDispatch, pushTrace, trans.processing, trans.recording, trans.text]);

  useEffect(() => {
    if (trans.error) {
      window.notifications.send(trans.error);
      pushTrace(`Error: ${trans.error}`);
    }
  }, [pushTrace, trans.error]);

  useEffect(() => {
    const cleanup = window.notifications.on((message: string) => {
      pushTrace(`Notify: "${message}" `);
      pillDispatch({ type: "NOTIFY", msg: message });
    });
    return cleanup;
  }, [pillDispatch, pushTrace]);

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
  }, [pillDispatch, pushTrace]);

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
  }, [pillDispatch, pushTrace, trans]);

  // Notification duration for NOTIFICATION, and optional post-notification hide
  useEffect(() => {
    if (pillState === "NOTIFICATION" && pillContext.notifMsg) {
      const shouldHideAfter = pendingHideAfterCollapse.active;
      const onAfter = pendingHideAfterCollapse.onAfter;
      const timeout = setTimeout(async () => {
        pillDispatch({ type: "ANIM_DONE" });

        // If we need to hide after notification, add a small delay to ensure
        // pill state machine completes its transition to IDLE cleanly
        if (shouldHideAfter) {
          setTimeout(async () => {
            try {
              await window.electron?.hideFloatingBarIndefinitely?.();
            } catch {}
            // Allow the fade-out in main to complete before showing onboarding
            setTimeout(() => {
              try { onAfter && onAfter(); } catch {}
              setPendingHideAfterCollapse({ active: false, message: "" });
            }, 180);
          }, 100); // let pill reach IDLE state properly before starting fade-out
        }
      }, NOTIFICATION_DURATION_MS);
      return () => clearTimeout(timeout);
    }
  }, [pillState, pillContext.notifMsg, pendingHideAfterCollapse.active, pendingHideAfterCollapse.onAfter]);

  const notifyThenHide = useCallback((message: string, onAfter?: () => void) => {
    try {
      window.notifications?.send?.(message);
    } catch {}
    // Defer actual hide until NOTIFICATION finishes and we return to IDLE
    setPendingHideAfterCollapse({ active: true, message, onAfter });
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
  const notchTarget = notchWidth && notchWidth > 0 ? notchWidth : null;
  const baseWidthTarget = notchTarget ?? TOKENS.PILL_BASE_W;
  const baseWidthScale = notchTarget ? 1 : S;
  const BASE_W = Math.round(baseWidthTarget * baseWidthScale);
  const BASE_H = Math.round(TOKENS.PILL_BASE_H * S);
  const RESTING_H = Math.round(TOKENS.PILL_RESTING_H * S);
  const EXPANDED_W = Math.round(CONTENT_WIDTH * S);
  const EXPANDED_H = Math.round(CONTENT_HEIGHT * S);
  const MAX_W = Math.round(TOKENS.PILL_MAX_W * S);

  useEffect(() => {
    const notchAvailable = typeof notchTarget === "number" && notchTarget > 0;
    const reason = notchAvailable
      ? `locked to notch width ${notchTarget.toFixed(2)}`
      : `fallback to TOKENS.PILL_BASE_W (${TOKENS.PILL_BASE_W}) * scale ${S.toFixed(3)}`;
    const key = `${BASE_W}-${reason}`;
    if (notchDecisionLogRef.current !== key) {
      notchDecisionLogRef.current = key;
      console.log(`[PillWidth] base=${BASE_W}px (${reason})`);
    }
  }, [BASE_W, S, notchTarget]);

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
      if (isOptionDownRef.current) {
        pushTrace(`PTT down ignored (already active)`);
        return;
      }
      isOptionDownRef.current = true;
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      startCuePlayedRef.current = false;
      if (latestTransRef.current.processing) {
        if (window.notifications?.send) {
          window.notifications.send("Still transcribing… wait a sec");
        }
        isOptionDownRef.current = false;
        return;
      }
      if (latestTransRef.current.recording) {
        return;
      }
      isLongPressRef.current = false;
      beginPermissionCheck();
      const holdNonce = ++gestureTokenCounterRef.current;
      holdActivationNonceRef.current = holdNonce;
      pressTimerRef.current = setTimeout(() => {
        if (holdActivationNonceRef.current !== holdNonce) {
          pushTrace(`PTT long press timer stale`);
          return;
        }
        if (!isOptionDownRef.current) {
          pushTrace(`PTT long press timer fired but key not down`);
          return;
        }
        isLongPressRef.current = true;
        holdActivationNonceRef.current = null;
        if (!startCuePlayedRef.current) {
          try {
            playToggleOn();
          } catch {}
          startCuePlayedRef.current = true;
        }
        if (doubleTapTimerRef.current) {
          clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = null;
        }
        lastTapUpRef.current = null;
        const {
          permissionToken,
          permissionResult,
          permissionPromise,
        } = snapshotPermissionGuard();
        pushTrace(`PTT long press start (pending gate)`);
        pillDispatch({ type: "PTT_START" });
        const tokenId = ++gestureTokenCounterRef.current;
        pendingStartTokenRef.current = { id: tokenId, kind: "hold" };
        beginCaptureSession(tokenId, "hold");
        if (permissionResult === false) {
          void handlePermissionOutcome(false, tokenId, "hold", permissionToken);
          return;
        }
        if (!isOptionDownRef.current) {
          pendingStartTokenRef.current = null;
          isLongPressRef.current = false;
          pushTrace(`PTT long press gate aborted (key lifted)`);
          pillDispatch({ type: "CANCEL" });
          clearActiveCapture(tokenId);
          return;
        }
        let startResult: void | Promise<void>;
        try {
          startResult = latestTransRef.current.start();
        } catch (err) {
          pushTrace(
            `PTT hold start failed synchronously: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          clearActiveCapture(tokenId);
          pillDispatch({ type: "CANCEL" });
          return;
        }
        monitorStartResolution(
          tokenId,
          "hold",
          Promise.resolve(startResult),
        );
        if (permissionResult === true) {
          void handlePermissionOutcome(true, tokenId, "hold", permissionToken);
          return;
        }
        pushTrace(`PTT long press capture pending gate`);
        attachPermissionPromise(
          permissionPromise,
          tokenId,
          "hold",
          permissionToken,
        );
      }, HOLD_DURATION_MS);
    };

    const handleFunctionKeyUp = () => {
      pushTrace(`PTT up`);
      if (!isOptionDownRef.current) {
        pushTrace(`PTT up ignored (no active press)`);
        lastTapUpRef.current = null;
        if (doubleTapTimerRef.current) {
          clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = null;
        }
        return;
      }
      isOptionDownRef.current = false;
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
      holdActivationNonceRef.current = null;
      if (
        pendingStartTokenRef.current?.kind === "hold" &&
        !latestTransRef.current.recording
      ) {
        pendingStartTokenRef.current = null;
      }
      if (isLongPressRef.current) {
        const activeHold =
          activeCaptureRef.current?.kind === "hold"
            ? activeCaptureRef.current
            : null;
        if (latestTransRef.current.recording) {
          pendingStartTokenRef.current = null;
          latestTransRef.current.stop();
          pushTrace(`PTT long press stop`);
          pillDispatch({ type: "PTT_STOP" });
          if (activeHold) {
            clearActiveCapture(activeHold.token);
          }
        } else {
          pendingStartTokenRef.current = null;
          if (activeHold) {
            schedulePostStartAction(activeHold.token, "cancel");
          }
          pushTrace(`PTT long press canceled before start`);
          pillDispatch({ type: "CANCEL" });
        }
      } else {
        const now = Date.now();
        const DOUBLE_MS = 220;
        if (lastTapUpRef.current && now - lastTapUpRef.current <= DOUBLE_MS) {
          if (doubleTapTimerRef.current) {
            clearTimeout(doubleTapTimerRef.current);
            doubleTapTimerRef.current = null;
          }
          const pendingTokenId = pendingStartTokenRef.current?.id ?? null;
          const pendingHandsFree =
            pendingStartTokenRef.current?.kind === "doubleTap";
          lastTapUpRef.current = null;
          if (latestTransRef.current.recording) {
            pendingStartTokenRef.current = null;
            latestTransRef.current.stop();
            pushTrace(`PTT double-tap stop`);
            pillDispatch({ type: "PTT_STOP" });
            if (activeCaptureRef.current?.kind === "doubleTap") {
              clearActiveCapture(activeCaptureRef.current.token);
            }
          } else if (pendingHandsFree) {
            pendingStartTokenRef.current = null;
            pushTrace(`PTT double-tap start canceled before activation`);
            pillDispatch({ type: "CANCEL" });
            if (pendingTokenId != null) {
              clearActiveCapture(pendingTokenId);
            }
          } else {
            const {
              permissionToken,
              permissionResult,
              permissionPromise,
            } = snapshotPermissionGuard();
            const tokenId = ++gestureTokenCounterRef.current;
            pendingStartTokenRef.current = { id: tokenId, kind: "doubleTap" };
            beginCaptureSession(tokenId, "doubleTap");
            if (!startCuePlayedRef.current) {
              try {
                playToggleOn();
              } catch {}
              startCuePlayedRef.current = true;
            }
            pillDispatch({ type: "PTT_START" });
            pushTrace(`PTT double-tap start (pending gate)`);
            if (permissionResult === false) {
              void handlePermissionOutcome(
                false,
                tokenId,
                "doubleTap",
                permissionToken,
              );
              return;
            }
            let startResult: void | Promise<void>;
            try {
              startResult = latestTransRef.current.start();
            } catch (err) {
              pushTrace(
                `PTT double-tap start failed synchronously: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
              clearActiveCapture(tokenId);
              pillDispatch({ type: "CANCEL" });
              return;
            }
            monitorStartResolution(
              tokenId,
              "doubleTap",
              Promise.resolve(startResult),
            );
            if (permissionResult === true) {
              void handlePermissionOutcome(
                true,
                tokenId,
                "doubleTap",
                permissionToken,
              );
              return;
            }
            pushTrace(`PTT double-tap capture pending gate`);
            attachPermissionPromise(
              permissionPromise,
              tokenId,
              "doubleTap",
              permissionToken,
            );
          }
        } else {
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
  }, [
    attachPermissionPromise,
    beginPermissionCheck,
    clearActiveCapture,
    handlePermissionOutcome,
    monitorStartResolution,
    pushTrace,
    schedulePostStartAction,
    snapshotPermissionGuard,
  ]);

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
        onStartDictation={() => undefined}
        onStopDictation={() => {
          pendingStartTokenRef.current = null;
          pillDispatch({ type: "PTT_STOP" });
          trans.stop();
          if (activeCaptureRef.current) {
            clearActiveCapture(activeCaptureRef.current.token);
          }
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

          const message = "Floating Bar Hidden. Use the Tray Menu to bring it back.";
          // If expanded, defer notification until collapse to avoid jank
          if (pillState === "EXPANDED") {
            setPendingHideAfterCollapse({ active: true, message });
            return;
          }
          // If not expanded, show heads-up now and then hide after it settles
          notifyThenHide(message);
        }}
        shareTranscriptionsEnabled={shareTranscriptionsEnabled}
        shareTranscriptionsLoading={shareTranscriptionsLoading}
        shareTranscriptionsUpdating={shareTranscriptionsUpdating}
        onShareTranscriptionsChange={handleSharePreferenceToggle}
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