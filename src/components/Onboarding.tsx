import React, { useState, useEffect, useRef } from "react";
import { playToggleOn } from "../utils/audioFeedback";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "./ui/select";
import { useTranscription } from "../hooks/useTranscription";
import SfIcon from "./icons/SfIcon";
import {
  getSupabase,
  getGoogleOAuthUrl,
  startEmailOtp,
  handleAuthCallbackUrl,
  getCurrentUser,
  getProfile,
  markOnboardingDone,
  ensureProfileRow,
} from "../lib/supabaseClient";
import { usePermissions, type PermissionProvider } from "../hooks/usePermissions";
// Development flags - only enabled in development mode
const isDevelopment = process.env.NODE_ENV === "development";
// Make permission mocking opt-in via URL (?mockPerms)
const params =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
const devFlags = {
  mockPermissionStates: isDevelopment && params.has("mockPerms"),
  showDebugOverlay: isDevelopment,
  fastAnimations: isDevelopment,
  alwaysShowDevMode: isDevelopment,
  isDevelopment,
  methods: {
    devLog: (...args: unknown[]) => {
      if (isDevelopment) console.log("[DEV]", ...args);
    },
    devNotify: (message: string) => {
      if (isDevelopment) console.log("[DEV NOTIFY]", message);
    },
  },
};

// Simple mock for now - starting in disabled state for UI development
const mockPermissions = {
  checkPermissions: async () => ({ needAX: true, needIM: true, isDev: true }),
  checkMicrophonePermission: async () => ({ status: "denied", granted: false }),
  requestMicrophonePermission: async () => ({ success: true, granted: true }),
  askIM: async () => ({ success: true, status: "authorized" }),
  requestAccessibilityPermission: async () => ({ success: true }),
  openSystemPreferences: async () => ({ success: true }),
  resetPermissions: () => {
    if (isDevelopment) console.debug("[MockPermissions] resetPermissions");
  },
};

type OnboardingStep =
  | "auth"
  | "permissions"
  | "mic-check"
  | "hotkey-info"
  | "hotkey-test"
  | "hotkey-tap-test"
  | "complete";

const Onboarding: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("auth");
  const [authEmail, setAuthEmail] = useState("");
  const [authEmailRequested, setAuthEmailRequested] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Permissions via shared hook (deduplicated across surfaces)
  const mockProvider: PermissionProvider | undefined = devFlags.mockPermissionStates
    ? {
        checkPermissions: mockPermissions.checkPermissions,
        checkMicrophonePermission: mockPermissions.checkMicrophonePermission,
        requestMicrophonePermission: mockPermissions.requestMicrophonePermission,
        askIM: mockPermissions.askIM,
        requestAccessibilityPermission: mockPermissions.requestAccessibilityPermission,
        openSystemPreferences: mockPermissions.openSystemPreferences,
      }
    : undefined;
  const {
    permissions,
    ui,
    init: initPermissions,
    requestMicrophone,
    requestAccessibility,
    requestInputMonitoring,
    setPermissions,
  } = usePermissions(mockProvider, { pollIntervalMs: 1000, deepLinkGraceMs: 4000 });
  const [isDev, setIsDev] = useState(false);
  const [pttApiReady, setPttApiReady] = useState(false);
  const [fnKeyPressed, setFnKeyPressed] = useState(false);
  const [cmdKeyPressed, setCmdKeyPressed] = useState(false);
  // Double-tap detection for hands-free (Right Option)
  const lastTapTimeRef = useRef<number | null>(null);
  const doubleTapTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cmdTapTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track mount state and timeout handles to prevent leaks
  const isMountedRef = useRef(true);
  const pttCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mic-check visualizer state
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const [barValues, setBarValues] = useState<number[]>(Array.from({ length: 24 }, () => 0));
  const [speakingDetected, setSpeakingDetected] = useState(false);
  const [micDevices, setMicDevices] = useState<Array<{ id: string; label: string }>>([
    { id: "default", label: "System Default" },
  ]);
  const [selectedMicId, setSelectedMicId] = useState<string>("default");
  // Sample prompts for tests
  const sampleHoldText =
    "Hi Sam, thanks for your note. I’d love to sync next week. Thanks!";
  const sampleTapText =
    "Let’s meet Tuesday at 2 PM. Actually, scratch that. Thursday at 11 AM works better.";

  // Debug logging and listen for explicit PTT readiness from helper
  useEffect(() => {
    devFlags.methods.devLog("Component mounted");
    devFlags.methods.devLog("Current step:", currentStep);
    devFlags.methods.devLog("Window location:", window.location.href);

    // Listen for explicit ready from main/helper
    const cleanupReady = window.ptt?.onReady?.(() => {
      devFlags.methods.devLog("Received ptt-ready");
      setPttApiReady(true);
    });

    return () => {
      cleanupReady && cleanupReady();
    };
  }, []);

  // Note: App location check moved to silent background check
  // No longer part of onboarding wizard flow

  // Initial permission check via shared hook
  useEffect(() => {
    initPermissions();
    // Mirror previous debug mode flag
    setIsDev(devFlags.isDevelopment);
  }, []);

  useEffect(() => {
    initPermissions();

    // FIX 13: Ensure DOM is fully ready before showing content
    const handleDOMContentLoaded = () => {
      // Force a small delay to ensure vibrancy has settled
      setTimeout(() => {
        const onboardingWindow = document.querySelector(
          ".onboarding-window",
        ) as HTMLElement;
        if (onboardingWindow) {
          devFlags.methods.devLog("DOM ready, ensuring vibrancy visibility");
          // Ensure the window becomes visible by triggering a minimal style change
          onboardingWindow.style.transform = "translateZ(0)";
        }
      }, 50);
    };

    // FIX 14: Handle initial content load timing
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", handleDOMContentLoaded);
    } else {
      // DOM already loaded
      handleDOMContentLoaded();
    }

    // Fix resize color glitching by temporarily disabling backdrop-filter
    let resizeTimeout: NodeJS.Timeout | null = null;

    const handleResizeStart = () => {
      const onboardingWindow = document.querySelector(
        ".onboarding-window",
      ) as HTMLElement;
      if (onboardingWindow) {
        onboardingWindow.classList.add("resizing");
      }
    };

    const handleResizeEnd = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const onboardingWindow = document.querySelector(
          ".onboarding-window",
        ) as HTMLElement;
        if (onboardingWindow) {
          onboardingWindow.classList.remove("resizing");
        }
      }, 150);
    };

    // Listen for window resize events
    window.addEventListener("resize", handleResizeStart);
    window.addEventListener("resize", handleResizeEnd);

    return () => {
      document.removeEventListener("DOMContentLoaded", handleDOMContentLoaded);
      window.removeEventListener("resize", handleResizeStart);
      window.removeEventListener("resize", handleResizeEnd);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, []);

  // Clear any active polling timers on unmount
  useEffect(() => {
    return () => {
      setFnKeyPressed(false); // Reset Fn key state
      setCmdKeyPressed(false);
      isMountedRef.current = false;
      if (pttCheckTimeoutRef.current) {
        clearTimeout(pttCheckTimeoutRef.current);
        pttCheckTimeoutRef.current = null;
      }
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
      if (cmdTapTimerRef.current) {
        clearTimeout(cmdTapTimerRef.current);
        cmdTapTimerRef.current = null;
      }
    };
  }, []);

  // Helper to get the current steps array
  const getSteps = (): OnboardingStep[] => [
    "auth",
    "permissions",
    "mic-check",
    "hotkey-info",
    "hotkey-test",
    "hotkey-tap-test",
    "complete",
  ];

  // Permission aggregates
  const allPermissionsGranted =
    permissions.microphone &&
    permissions.accessibility &&
    permissions.inputMonitoring;

  // Initial auth check and deep-link listener
  useEffect(() => {
    getSupabase();
    (async () => {
      const skipAuth = !!window.devFlags?.skipAuth;
      const forceOnboarding = !!window.devFlags?.forceOnboarding;
      const user = skipAuth ? { id: "dev" } : await getCurrentUser();
      // In FORCE_ONBOARDING mode, never auto-complete; start at permissions.
      if (forceOnboarding) {
        setCurrentStep("permissions");
        return;
      }
      if (!user && !skipAuth) return; // stay on auth step
      try {
        // Ensure a profile row exists for returning users (or first login on this device)
        try {
          await ensureProfileRow();
        } catch {}
        const profile = await getProfile();
        if (profile?.onboarding_done) {
          try {
            await window.electron?.setPttTarget?.("main");
          } catch (e) {
            console.warn("[Onboarding] setPttTarget failed:", e);
          }
          // (Removed) auth:set-signed-in — Supabase session is the source of truth
          await window.electron?.onboardingComplete();
          return;
        }
      } catch {}
      setCurrentStep("permissions");
    })();
    const off = window.auth?.onCallback?.(async ({ url }) => {
      devFlags.methods.devLog("[Auth] onCallback URL:", url);
      setAuthLoading(true);
      setAuthError(null);
      const res = await handleAuthCallbackUrl(url);
      setAuthLoading(false);
      if (!res.ok) {
        setAuthError(res.error || "Login failed");
        return;
      }
      try {
        // Ensure a profile row exists as soon as login completes
        try {
          await ensureProfileRow();
        } catch {}
        const profile = await getProfile();
        const forceOnboarding = !!window.devFlags?.forceOnboarding;
        if (!forceOnboarding && profile?.onboarding_done) {
          try {
            await window.electron?.setPttTarget?.("main");
          } catch (e) {
            console.warn("[Onboarding] setPttTarget failed:", e);
          }
          // (Removed) auth:set-signed-in — Supabase session is the source of truth
          await window.electron?.onboardingComplete();
          return;
        }
      } catch {}
      setCurrentStep("permissions");
    });
    return () => {
      off && off();
    };
  }, []);

  const handleGoogle = async () => {
    try {
      setAuthLoading(true);
      setAuthError(null);
      const url = await getGoogleOAuthUrl();
      setAuthLoading(false);
      if (url) {
        await window.electron?.openExternal(url);
      } else {
        setAuthError(
          "Authentication setup failed. Please ensure Sonic Flow is properly configured and try again.",
        );
      }
    } catch (e: unknown) {
      setAuthLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      setAuthError(msg || "Could not start Google sign-in");
    }
  };

  const handleEmailStart = async () => {
    setAuthLoading(true);
    setAuthError(null);
    const res = await startEmailOtp(authEmail.trim());
    setAuthLoading(false);
    if (!res.ok) {
      setAuthError(res.error || "Failed to send code");
      return;
    }
    setAuthEmailRequested(true);
  };

  // Allow pressing Enter in the email field to submit
  const handleEmailSubmit: React.FormEventHandler<HTMLFormElement> = async (
    e,
  ) => {
    e.preventDefault();
    if (authLoading) return;
    if (!authEmail || !authEmail.trim()) return;
    await handleEmailStart();
  };

  // Start helper when entering the hotkey info step (after permissions) so Fn key testing works
  useEffect(() => {
    if (currentStep === "hotkey-info" && !pttApiReady) {
      // Ensure PTT events route to onboarding while testing
      window.electron?.setPttTarget?.("onboarding");
      const startHelperForTesting = async () => {
        try {
          devFlags.methods.devLog("Starting helper for onboarding testing...");
          await window.electron?.startHelper();
          // Helper will emit 'ready' -> handled by onReady listener above.
        } catch (error) {
          if (isDevelopment)
            console.error("Error starting helper for testing:", error);
        }
      };
      startHelperForTesting();
    }
    return () => {
      if (pttCheckTimeoutRef.current) {
        clearTimeout(pttCheckTimeoutRef.current);
        pttCheckTimeoutRef.current = null;
      }
    };
  }, [currentStep, pttApiReady]);

  // Auto-advance disabled per UX: user will click Next explicitly
  // useEffect(() => {
  //   if (currentStep === "permissions" && allPermissionsGranted) {
  //     setTimeout(() => {
  //       setCurrentStep("hotkey-info");
  //     }, 1200);
  //   }
  // }, [currentStep, allPermissionsGranted]);

  // Navigation functions
  const nextStep = () => {
    const steps = getSteps();
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex < steps.length - 1) {
      // Reset Fn key visual state when leaving hotkey pages
      if (currentStep === "hotkey-info" || currentStep === "hotkey-test") {
        setFnKeyPressed(false);
      }
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const prevStep = () => {
    const steps = getSteps();
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      // Reset Fn key visual state when leaving hotkey pages
      if (currentStep === "hotkey-info" || currentStep === "hotkey-test") {
        setFnKeyPressed(false);
      }
      setCurrentStep(steps[currentIndex - 1]);
    }
  };

  // Prepare the pill (create main window + tray) when entering either hotkey test step
  const pillPreparedRef = useRef(false);
  useEffect(() => {
    if ((currentStep === "hotkey-test" || currentStep === "hotkey-tap-test") && !pillPreparedRef.current) {
      pillPreparedRef.current = true;
      try {
        window.electron?.preparePill?.();
      } catch (e) {
        if (isDevelopment) console.error("Error preparing pill window:", e);
      }
    }
  }, [currentStep]);

  // Ask the pill renderer to expand itself (no direct window movement here)
  useEffect(() => {
    if (currentStep === "hotkey-test" || currentStep === "hotkey-tap-test") {
      // Route PTT to onboarding so this step receives Fn events
      window.electron?.setPttTarget?.("onboarding");
      window.electron?.expandPill?.(() => undefined);
    }
  }, [currentStep]);

  // --- Mic-check visualizer lifecycle ---
  const stopMic = () => {
    try {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
    } catch {}
    rafIdRef.current = null;
    try {
      analyserRef.current?.disconnect();
    } catch {}
    analyserRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
    try {
      micStreamRef.current?.getTracks()?.forEach((t) => t.stop());
    } catch {}
    micStreamRef.current = null;
  };

  const startMic = async () => {
    try {
      // Ensure any previous session is closed
      stopMic();
      const constraints: MediaStreamConstraints = {
        video: false,
        audio:
          selectedMicId && selectedMicId !== "default"
            ? { deviceId: { exact: selectedMicId } }
            : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStreamRef.current = stream;
      // Prefer a typed fallback for WebKit without using any
      const Ctor: typeof AudioContext =
        (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)!;
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512; // fine-grained but light
      analyser.smoothingTimeConstant = 0.85;
      src.connect(analyser);
      analyserRef.current = analyser;

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const NUM_BARS = 24;

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(freqData);
        // Group bins into NUM_BARS buckets
        const buckets: number[] = new Array(NUM_BARS).fill(0);
        const binsPerBar = Math.max(1, Math.floor(freqData.length / NUM_BARS));
        let energy = 0;
        for (let i = 0; i < NUM_BARS; i++) {
          let sum = 0;
          const start = i * binsPerBar;
          const end = Math.min(freqData.length, start + binsPerBar);
          for (let j = start; j < end; j++) sum += freqData[j];
          const avg = sum / (end - start || 1);
          buckets[i] = avg / 255; // normalize 0..1
          energy += avg;
        }
        const avgEnergy = energy / freqData.length;
        setSpeakingDetected((prev) => (avgEnergy > 14 ? true : prev));
        setBarValues(buckets);
        rafIdRef.current = requestAnimationFrame(tick);
      };
      rafIdRef.current = requestAnimationFrame(tick);
    } catch (e) {
      // If mic unavailable, keep UI but don't block progression
      setSpeakingDetected(false);
      try {
        if (isDevelopment) console.error("[Onboarding] startMic failed:", e);
      } catch {}
    }
  };

  useEffect(() => {
    if (currentStep === "mic-check") {
      startMic();
      return () => stopMic();
    }
    // Stop when leaving mic-check
    stopMic();
  }, [currentStep]);

  // Restart capture when device changes
  useEffect(() => {
    if (currentStep !== "mic-check") return;
    startMic();
    try {
      // Persist selection to main so app-wide mic matches user choice
      if (selectedMicId) window.mic?.select?.(selectedMicId);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMicId]);

  // Enumerate mics when entering mic-check
  useEffect(() => {
    if (currentStep !== "mic-check") return;
    let cancelled = false;
    (async () => {
      try {
        // Seed from main if present
        let seedId: string | null = null;
        try {
          const res = await window.mic?.getSelected?.();
          seedId = res?.id ?? null;
        } catch {}
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ id: d.deviceId || "default", label: d.label || "Microphone" }));
        const deduped = inputs.length
          ? inputs
          : [{ id: "default", label: "System Default" }];
        if (!cancelled) {
          setMicDevices(deduped);
          const next = seedId && deduped.some((d) => d.id === seedId) ? seedId : deduped[0]?.id;
          if (next) setSelectedMicId(next);
          try {
            window.mic?.updateDevices?.(
              deduped.map((d) => ({ id: d.id, label: d.label })),
              next || undefined,
            );
          } catch {}
        }
      } catch {
        if (!cancelled) setMicDevices([{ id: "default", label: "System Default" }]);
      }
    })();
    const off = window.mic?.onSelectedChanged?.(({ id }) => {
      try {
        if (id && id !== selectedMicId) setSelectedMicId(id);
      } catch {}
    });
    return () => {
      cancelled = true;
      try { off && off(); } catch {}
    };
  }, [currentStep]);

  // Auto-focus the text box on test steps for better UX
  useEffect(() => {
    if (currentStep !== "hotkey-test" && currentStep !== "hotkey-tap-test") return;
    const id = setTimeout(() => {
      textAreaRef.current?.focus();
    }, 50);
    return () => clearTimeout(id);
  }, [currentStep]);

  // Permission handlers are now provided by the shared hook

  const handleRequestInputMonitoring = async () => {
    await requestInputMonitoring();
  };

  const handleRequestAccessibility = async () => {
    await requestAccessibility();
  };

  const handleRequestMicrophone = async () => {
    await requestMicrophone();
  };

  const handleComplete = async () => {
    // Finish onboarding from the Complete screen
    // Helper should already be running from permissions step, but ensure it's started
    try {
      await window.electron?.startHelper(); // Safe to call multiple times
    } catch (error) {
      if (isDevelopment) console.error("Error starting helper:", error);
    }
    try {
      // Route PTT to main app after onboarding
      window.electron?.setPttTarget?.("main");
      try {
        await markOnboardingDone();
      } catch {}
      await window.electron?.onboardingComplete();
    } catch (error) {
      if (isDevelopment) console.error("Error completing onboarding:", error);
    }
    // Small delay for UX before closing
    setTimeout(() => {
      try {
        window.electron?.closeOnboarding?.();
      } catch (e) {
        /* ignore */
      }
    }, 300);
  };

  // Step progress indicator
  // Returns the index among ['welcome','permissions','hotkey-test'], or -1 when not applicable
  const getProgressStepIndex = () => {
    const steps = getSteps();
    // Progress steps include welcome and exclude 'complete'
    const progressSteps = steps.slice(0, -1);
    return progressSteps.indexOf(currentStep);
  };

  // Animation variants (with dev speed control)
  const spring = devFlags.fastAnimations
    ? { type: "spring" as const, stiffness: 420, damping: 30, mass: 0.35 }
    : { type: "spring" as const, stiffness: 340, damping: 28, mass: 0.45 };
  const containerVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: spring },
    exit: { opacity: 0, y: -16, transition: spring },
  };

  // --- Dictation test wiring for Hotkey step ---
  // In onboarding, avoid auto enumeration/init to prevent early mic prompts.
  const trans = useTranscription({
    autoEnumerateDevices: false,
    autoInitStream: false,
  });
  const [testText, setTestText] = useState("");
  const [testTextTap, setTestTextTap] = useState("");
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const prevStepRef = useRef<OnboardingStep | null>(null);

  // Minimal debounce utility
  const debounce = <T extends (...args: unknown[]) => void>(
    func: T,
    delay: number,
  ) => {
    let timeoutId: NodeJS.Timeout | null = null;
    return (...args: Parameters<T>) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), delay);
    };
  };

  // Append recognized text to test area(s)
  useEffect(() => {
    if (trans.text) {
      if (currentStep === "hotkey-test") {
        setTestText((prev) => (prev ? `${prev} ${trans.text}` : trans.text));
      } else if (currentStep === "hotkey-tap-test") {
        setTestTextTap((prev) => (prev ? `${prev} ${trans.text}` : trans.text));
      }
    }
  }, [trans.text, currentStep]);

  // Ensure transcription is stopped when leaving tap-to-talk step
  useEffect(() => {
    const previous = prevStepRef.current;
    if (previous === "hotkey-tap-test" && currentStep !== "hotkey-tap-test") {
      try {
        if (trans.recording) trans.stop();
      } catch {}
    }
    prevStepRef.current = currentStep;
    // We intentionally depend on currentStep and trans.recording state only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, trans.recording]);

  // Hook hotkey: Right Option — hold-to-speak on hotkey-test, double-tap-to-toggle on hotkey-tap-test
  useEffect(() => {
    if (!window.ptt?.onDown || !window.ptt?.onUp) {
      devFlags.methods.devLog("PTT API not available yet, waiting...");
      return;
    }

    devFlags.methods.devLog("PTT API available, setting up Right Option handlers");
    const HOLD_MS = 90;
    const handleDown = () => {
      devFlags.methods.devLog("Hotkey pressed down");
      setFnKeyPressed(true); // Immediate visual feedback

      if (currentStep === "hotkey-test") {
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        if (trans.processing || trans.recording) return;
        isLongPressRef.current = false;
        pressTimerRef.current = setTimeout(() => {
          isLongPressRef.current = true;
          try { playToggleOn(); } catch {}
          if (!trans.recording) trans.start();
        }, HOLD_MS);
      } else if (currentStep === "hotkey-tap-test") {
        if (trans.processing) return;
        const now = Date.now();
        const DOUBLE_MS = 220;
        if (lastTapTimeRef.current && now - lastTapTimeRef.current <= DOUBLE_MS) {
          // Double-tap detected
          if (doubleTapTimerRef.current) {
            clearTimeout(doubleTapTimerRef.current);
            doubleTapTimerRef.current = null;
          }
          lastTapTimeRef.current = null;
          if (!trans.recording) {
            try { playToggleOn(); } catch {}
            trans.start();
          } else {
            trans.stop();
          }
        } else {
          // First tap: arm a window for second tap
          lastTapTimeRef.current = now;
          if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = setTimeout(() => {
            lastTapTimeRef.current = null;
            doubleTapTimerRef.current = null;
          }, DOUBLE_MS);
        }
      }
    };
    const handleUp = () => {
      devFlags.methods.devLog("Hotkey released");
      setFnKeyPressed(false); // Immediate visual feedback

      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
      // For hold-to-speak, stop on release; for double-tap, ignore release
      if (currentStep === "hotkey-test" && trans.recording) trans.stop();
      isLongPressRef.current = false;
    };

    const cleanupDown = window.ptt.onDown(debounce(handleDown, 25));
    const cleanupUp = window.ptt.onUp(debounce(handleUp, 25));
    return () => {
      cleanupDown?.();
      cleanupUp?.();
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
      if (doubleTapTimerRef.current) {
        clearTimeout(doubleTapTimerRef.current);
        doubleTapTimerRef.current = null;
      }
    };
  }, [trans.recording, trans.processing, pttApiReady, currentStep]); // Re-run when PTT API becomes ready

  // Hook cancel: Right Command — visual press on down; cancel on release during test steps
  useEffect(() => {
    const inRelevantStep =
      currentStep === "hotkey-info" ||
      currentStep === "hotkey-test" ||
      currentStep === "hotkey-tap-test";
    if (!inRelevantStep) return;
    const cleanups: Array<() => void> = [];
    // Down: show visual pressed state
    if (window.ptt?.onCancelDown) {
      cleanups.push(
        window.ptt.onCancelDown(() => {
          setCmdKeyPressed(true);
        }),
      );
    }
    // Up: clear pressed state and cancel if in test steps
    if (window.ptt?.onCancel) {
      cleanups.push(
        window.ptt.onCancel(() => {
          setCmdKeyPressed(false);
          // Clear any pending Option timers and visual state
          if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
          }
          setFnKeyPressed(false);
          if (currentStep === "hotkey-test" || currentStep === "hotkey-tap-test") {
            try {
              if (trans.recording || trans.processing) trans.cancel();
            } catch {}
          }
        }),
      );
    }
    return () => {
      cleanups.forEach((fn) => fn && fn());
    };
  }, [currentStep, trans.recording, trans.processing]);

  return (
    <div className="flex flex-col h-full min-h-screen text-foreground onboarding-window relative">
      {/* Native macOS traffic lights are now handled by Electron with titleBarStyle: 'hiddenInset' */}

      {/* Draggable Header Areas */}
      <div className="onboarding-header" />

      {/* Static top progress - glassy bars */}
      {currentStep !== "complete" && (
        <div className="absolute top-12 left-0 right-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="onboarding-progress-shell">
            {(() => {
              const progressSteps = getSteps().slice(0, -1);
              const idx = getProgressStepIndex();
              return progressSteps.map((step, i) => {
                const isComplete = i < idx;
                const isActive = i === idx;
                const growClass = isActive ? "grow-active" : "grow-inactive";
                const heightClass = isActive ? "h-[3px]" : "h-[2px]"; // minor height emphasis
                const toneClass = isActive
                  ? "bar-active"
                  : isComplete
                    ? "bar-complete"
                    : "bar-upcoming";
                return (
                  <div
                    key={step}
                    className={`onboarding-progress-bar ${toneClass} ${growClass} ${heightClass}`}
                  />
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* Development Mode Indicator & Controls */}
      {(isDev || devFlags.alwaysShowDevMode) && (
        <div className="absolute top-4 right-4 z-50 space-y-2">
          <div className="card-floating rounded-lg px-3 py-1">
            <span className="text-xs font-medium text-white/80">
              Development Mode
              {devFlags.mockPermissionStates && " (Mock)"}
            </span>
          </div>

          {devFlags.showDebugOverlay && (
            <div className="card-floating rounded-lg p-2 text-xs space-y-1">
              <div className="text-white/80 font-medium">Debug Panel</div>
              <div className="text-xs text-dimmed">Step: {currentStep}</div>
              <div className="text-xs text-dimmed">
                Perms: M:{permissions.microphone ? "✓" : "✗"}
                A:{permissions.accessibility ? "✓" : "✗"}
                I:{permissions.inputMonitoring ? "✓" : "✗"}
              </div>
              {devFlags.mockPermissionStates && (
                <button
                  className="text-white/70 hover:text-white/90 underline"
                  onClick={() => {
                    // Quick reset for development
                    setPermissions({
                      microphone: false,
                      accessibility: false,
                      inputMonitoring: false,
                    });
                    mockPermissions.resetPermissions();
                  }}
                >
                  Reset Mock Perms
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Close Button removed per design */}

      {/* Main Content - Single Column */}
      <div className="flex-1 flex flex-col justify-center p-6 pt-10 relative min-h-0 overflow-hidden">
        <div className="max-w-lg w-full mx-auto flex-1 flex flex-col justify-center max-h-full overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {/* Auth Step */}
            {currentStep === "auth" && (
              <motion.div
                key="auth"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-4"
              >
                <div className="heading-stack">
                  <h1 className="text-heading-xl heading-gradient heading-crisp text-breathe">
                    Welcome to Sonic Flow
                  </h1>
                  <p className="text-sm text-subtle leading-relaxed subheading">
                    Sign in to continue
                  </p>
                </div>
                <div className="mx-auto max-w-sm space-y-3">
                  {authError && (
                    <div className="text-[12px] text-red-300">{authError}</div>
                  )}
                  <Button
                    className="w-full onboarding-cta"
                    disabled={authLoading}
                    onClick={handleGoogle}
                  >
                    <span>Continue with Google</span>
                  </Button>
                  <div className="text-[11px] text-subtle">or</div>
                  {!authEmailRequested ? (
                    <form className="space-y-2" onSubmit={handleEmailSubmit}>
                      <input
                        type="email"
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        placeholder="Enter your email"
                        className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none"
                      />
                      <Button
                        className="w-full"
                        type="submit"
                        disabled={authLoading || !authEmail}
                      >
                        Send code
                      </Button>
                    </form>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[12px] text-subtle">
                        Check your email. After you click the link or enter the
                        code, you’ll be signed in.
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Hotkey Info Step */}
            {currentStep === "hotkey-info" && (
              <motion.div
                key="hotkey-info"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center"
              >
                <div className="heading-stack">
                  <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                    Your Hotkeys
                  </h2>
                  <p className="text-sm text-subtle leading-relaxed subheading">
                    Right Option to dictate. Right Command to cancel.
                  </p>
                </div>
                <div className="space-y-4">
                  <div className="flex flex-col items-center justify-center">
                    <div className="flex items-center gap-2">
                      {/* Right Command key (left, wider) */}
                      <div
                        className={`keycap keycap-lg keycap-wide ${cmdKeyPressed ? "keycap-active" : ""}`}
                        aria-label={"Command key - press to cancel dictation"}
                        aria-live="polite"
                      >
                        <span className="keycap-legend-top text-[14px] font-system">⌘</span>
                        <span className="keycap-legend-bottom text-[10px] font-system">command</span>
                      </div>
                      {/* Right Option key */}
                      <div
                        className={`keycap keycap-lg ${fnKeyPressed || trans.recording ? "keycap-active" : ""}`}
                        aria-label={
                          fnKeyPressed || trans.recording
                            ? "Option key active - recording in progress"
                            : "Option key - press and hold to start dictation"
                        }
                        aria-live="polite"
                      >
                        <span className="keycap-legend-top text-[14px] font-system">⌥</span>
                        <span className="keycap-legend-bottom text-[10px] font-system">option</span>
                      </div>
                    </div>
                    <p className="onboarding-note onboarding-content-gap">Press Right Option to test dictation. Press Right Command to test cancel.</p>
                  </div>
                </div>
                {/* Removed central Continue button; Next lives in bottom-right consistently */}
              </motion.div>
            )}
            {/* Legacy welcome step removed (block fully deleted) */}

            {/* Combined Permissions Step */}
            {currentStep === "permissions" && (
              <motion.div
                key="permissions"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-4"
              >
                <div className="heading-stack">
                  <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                    Enable Required Permissions
                  </h2>
                  <p className="text-sm text-subtle leading-relaxed subheading">
                    Sonic Flow needs these macOS permissions to work.
                  </p>
                </div>

                <div className="space-y-3">
                  {/* Microphone Permission */}
                  <div
                    className={`onboarding-permission-row rounded-lg p-3 transition-opacity duration-300 ${permissions.microphone ? "opacity-60" : "opacity-100"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                          <SfIcon
                            name="mic.fill"
                            size={16}
                            className="text-primary/70"
                          />
                        </div>
                        <div className="text-left">
                          <p className="text-[13px] font-medium text-foreground">
                            Microphone
                          </p>
                          <p className="text-[11px] text-subtle">
                            Capture your voice for dictation.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <div className="relative w-[84px] flex items-center justify-center">
                          <AnimatePresence mode="wait" initial={false}>
                            {!permissions.microphone ? (
                              <motion.div
                                key={
                                  ui.microphone.loading
                                    ? "mic-loading"
                                    : "mic-idle"
                                }
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="w-full flex items-center justify-center"
                              >
                                <Button
                                  size="sm"
                                  onClick={handleRequestMicrophone}
                                  disabled={ui.microphone.loading}
                                  className=" text-xs onboarding-cta w-full"
                                >
                                  <div className="relative flex items-center justify-center h-4">
                                    {ui.microphone.loading ? (
                                      <div className="h-4 w-4 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white" />
                                    ) : (
                                      <span>Enable</span>
                                    )}
                                  </div>
                                </Button>
                              </motion.div>
                            ) : (
                              <div className="flex items-center justify-center">
                                <motion.svg
                                  width="22"
                                  height="22"
                                  viewBox="0 0 24 24"
                                  className="text-white/80"
                                >
                                  <motion.path
                                    // Draw when just granted; otherwise show complete path instantly
                                    initial={{
                                      pathLength: ui.microphone.justGranted
                                        ? 0
                                        : 1,
                                    }}
                                    animate={{ pathLength: 1 }}
                                    transition={
                                      ui.microphone.justGranted
                                        ? {
                                            duration: 0.45,
                                            ease: [0.25, 0.8, 0.25, 1],
                                          }
                                        : { duration: 0 }
                                    }
                                    d="M5 13l4 4L19 7"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </motion.svg>
                              </div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>
                    {/* No separate denied section; user can press Enable again. */}
                  </div>

                  {/* Accessibility Permission */}
                  <div
                    className={`onboarding-permission-row rounded-lg p-3 transition-opacity duration-300 ${permissions.accessibility ? "opacity-60" : "opacity-100"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                          <SfIcon
                            name="accessibility"
                            size={16}
                            className="text-primary/70"
                          />
                        </div>
                        <div className="text-left">
                          <p className="text-[13px] font-medium text-foreground">
                            Accessibility
                          </p>
                          <p className="text-[11px] text-subtle">
                            Insert recognized text into your apps.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <div className="relative w-[84px] flex items-center justify-center">
                          <AnimatePresence mode="wait" initial={false}>
                            {!permissions.accessibility ? (
                              <motion.div
                                key={
                                  ui.accessibility.loading
                                    ? "ax-loading"
                                    : "ax-idle"
                                }
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="w-full flex items-center justify-center"
                              >
                                <Button
                                  size="sm"
                                  onClick={handleRequestAccessibility}
                                  disabled={ui.accessibility.loading}
                                  className="text-xs onboarding-cta w-full"
                                >
                                  <div className="relative flex items-center justify-center h-4">
                                    {ui.accessibility.loading ? (
                                      <div className="h-4 w-4 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white" />
                                    ) : (
                                      <span>Enable</span>
                                    )}
                                  </div>
                                </Button>
                              </motion.div>
                            ) : (
                              <div className="flex items-center justify-center">
                                <motion.svg
                                  width="22"
                                  height="22"
                                  viewBox="0 0 24 24"
                                  className="text-white/80"
                                >
                                  <motion.path
                                    initial={{
                                      pathLength: ui.accessibility.justGranted
                                        ? 0
                                        : 1,
                                    }}
                                    animate={{ pathLength: 1 }}
                                    transition={
                                      ui.accessibility.justGranted
                                        ? {
                                            duration: 0.45,
                                            ease: [0.25, 0.8, 0.25, 1],
                                          }
                                        : { duration: 0 }
                                    }
                                    d="M5 13l4 4L19 7"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </motion.svg>
                              </div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>
                    {/* No separate denied section; user can press Enable again. */}
                  </div>

                  {/* Input Monitoring Permission (restart required) */}
                  <div
                    className={`onboarding-permission-row rounded-lg p-3 transition-opacity duration-300 ${permissions.inputMonitoring ? "opacity-60" : "opacity-100"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                          <SfIcon
                            name="keyboard.badge.eye.fill"
                            size={16}
                            className="text-primary/70"
                          />
                        </div>
                        <div className="text-left">
                          <p className="text-[13px] font-medium text-foreground">
                            Input Monitoring
                          </p>
                          <p className="text-[11px] text-subtle">Detect the Right Option key to start and stop dictation.</p>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <div className="relative w-[84px] flex items-center justify-center">
                          <AnimatePresence mode="wait" initial={false}>
                            {!permissions.inputMonitoring ? (
                              <motion.div
                                key={
                                  ui.inputMonitoring.loading
                                    ? "im-loading"
                                    : "im-idle"
                                }
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="w-full flex items-center justify-center"
                              >
                                <Button
                                  size="sm"
                                  onClick={handleRequestInputMonitoring}
                                  disabled={ui.inputMonitoring.loading}
                                  className="text-xs onboarding-cta w-full"
                                >
                                  <div className="relative flex items-center justify-center h-4">
                                    {ui.inputMonitoring.loading ? (
                                      <div className="h-4 w-4 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white" />
                                    ) : (
                                      <span>Enable</span>
                                    )}
                                  </div>
                                </Button>
                              </motion.div>
                            ) : (
                              <div className="flex items-center justify-center">
                                <motion.svg
                                  width="22"
                                  height="22"
                                  viewBox="0 0 24 24"
                                  className="text-white/80"
                                >
                                  <motion.path
                                    initial={{
                                      pathLength: ui.inputMonitoring.justGranted
                                        ? 0
                                        : 1,
                                    }}
                                    animate={{ pathLength: 1 }}
                                    transition={
                                      ui.inputMonitoring.justGranted
                                        ? {
                                            duration: 0.45,
                                            ease: [0.25, 0.8, 0.25, 1],
                                          }
                                        : { duration: 0 }
                                    }
                                    d="M5 13l4 4L19 7"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </motion.svg>
                              </div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>

                    {/* No separate denied section; user can press Enable again. */}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Mic Check Step */
            }
            {currentStep === "mic-check" && (
              <motion.div
                key="mic-check"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-4"
              >
                <div className="heading-stack">
                  <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                    Let’s check your microphone
                  </h2>
                  <p className="text-sm text-subtle leading-relaxed subheading">
                    Pick the right input and say a few words. The bars should bounce.
                  </p>
                </div>

                {/* Mic selector */}
                <div className="mx-auto w-full max-w-xl">
                  <Select value={selectedMicId} onValueChange={(v) => setSelectedMicId(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select microphone" />
                    </SelectTrigger>
                    <SelectContent inPlace>
                      {micDevices.map((d) => (
                        <SelectItem key={d.id} value={d.id} className="text-sm">
                          {d.label || "Microphone"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-center py-3">
                  <div className="w-full max-w-xl h-24 rounded-lg card-floating p-3 flex items-end gap-[6px]">
                    {barValues.map((v, i) => {
                      const h = Math.max(6, Math.round(6 + v * 80));
                      const opacity = 0.45 + v * 0.55;
                      return (
                        <div
                          key={i}
                          className="flex-1 rounded-[3px] bg-white/70"
                          style={{ height: `${h}px`, opacity }}
                          aria-hidden
                        />
                      );
                    })}
                  </div>
                </div>

                <div className="text-[12px] text-dimmed">
                  {speakingDetected ? "We hear you — sounding good." : "No input yet. Say a few words to test your mic."}
                </div>
              </motion.div>
            )}

            {/* Hotkey Test Step */}
            {currentStep === "hotkey-test" && (
              <motion.div
                key="hotkey-test"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center overflow-hidden"
              >
                <div className="max-w-xl mx-auto text-left">
                  <div className="text-center heading-stack">
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Press and hold the Right Option Key
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      For Push-to-Talk, hold to speak. Release to stop.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {/* Sample hint as tertiary text for improved hierarchy */}
                    <div className="text-[11px] text-dimmed text-left">
                      Try saying: {sampleHoldText}
                    </div>

                    {/* Dictation Textarea */}
                    <div className="onboarding-content-gap">
                      {/* removed the small label above the textarea */}
                      <textarea
                        className={
                          "w-full h-28 resize-none onboarding-textarea px-4 py-4 text-sm outline-none overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 hover:scrollbar-thumb-white/30"
                        }
                        placeholder="Say something…"
                        value={testText}
                        onChange={(e) => setTestText(e.target.value)}
                        ref={textAreaRef}
                      />
                    </div>

                    {/* No CTA here; proceed with Next to the completion screen */}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Hotkey Tap Test Step */}
            {currentStep === "hotkey-tap-test" && (
              <motion.div
                key="hotkey-tap-test"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center overflow-hidden"
              >
                <div className="max-w-xl mx-auto text-left">
                  <div className="text-center heading-stack">
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Double-tap the Right Option Key
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      For Hands-free, double-tap to start. Double-tap again to stop.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {/* Sample hint as tertiary text for improved hierarchy */}
                    <div className="text-[11px] text-dimmed text-left">
                      Try saying: {sampleTapText}
                    </div>

                    {/* Dictation Textarea */}
                    <div className="onboarding-content-gap">
                      <textarea
                        className={
                          "w-full h-28 resize-none onboarding-textarea px-4 py-4 text-sm outline-none overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 hover:scrollbar-thumb-white/30"
                        }
                        placeholder="Say something…"
                        value={testTextTap}
                        onChange={(e) => setTestTextTap(e.target.value)}
                        ref={textAreaRef}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Complete Step */}
            {currentStep === "complete" && (
              <motion.div
                key="complete"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-4"
              >
                {/* Checkmark badge - matches waitlist modal */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 700, damping: 25 }}
                  className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/10 border border-white/20"
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="text-white/80"
                  >
                    <motion.path
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{
                        delay: 0.2,
                        duration: 0.6,
                        ease: [0.25, 0.8, 0.25, 1],
                      }}
                      d="M5 13l4 4L19 7"
                      stroke="currentColor"
                      strokeWidth="2.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </motion.div>
                <h2 className="text-heading-xl heading-gradient heading-crisp text-breathe">
                  You're all set
                </h2>
                <p className="text-sm text-subtle leading-relaxed">Your voice is now your keyboard. Use Right Option to dictate anywhere.</p>
                <div className="pt-2 flex justify-center">
                  <Button
                    onClick={handleComplete}
                    className="px-5 py-2 onboarding-cta shimmer"
                  >
                    Start Dictating
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Controls (hidden on auth & complete) */}
        {currentStep !== "complete" && currentStep !== "auth" && (
          <div className="absolute bottom-6 left-6 right-6 flex justify-between">
            <Button
              variant="secondary"
              onClick={prevStep}
              disabled={getProgressStepIndex() <= 0}
              className="px-3 py-1.5"
            >
              Back
            </Button>

            {/* Next button appears on permissions, hotkey-info, and hotkey-tap-test; always enabled except permissions gating */}
            {currentStep !== "hotkey-test" && (
              <Button
                variant="secondary"
                onClick={() => {
                  nextStep();
                }}
                disabled={
                  currentStep === "permissions" && !allPermissionsGranted
                }
                className="px-3 py-1.5"
              >
                Next
              </Button>
            )}
            {currentStep === "hotkey-test" && (
              <Button
                variant="secondary"
                onClick={() => setCurrentStep("hotkey-tap-test")}
                className="px-3 py-1.5"
              >
                Next
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
