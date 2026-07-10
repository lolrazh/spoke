import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import IntroExperience from "./intro/IntroExperience";
import { ParticlesCanvas } from "./shared/ParticlesCanvas";
import { GridBackground } from "./shared/GridBackground";
import { useMicVisualizer } from "../hooks/useMicVisualizer";
import { m, AnimatePresence, type Variants } from "framer-motion";
import { Button } from "./ui/button";
import Spinner from "./ui/Spinner";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "./ui/select";
import SfIcon from "./icons/SfIcon";
import ModelsList from "./ModelsList";
import {
  usePermissions,
  type PermissionProvider,
} from "../hooks/usePermissions";
import { useModelStatus } from "../hooks/useModelStatus";
import {
  buildOnboardingSteps,
  isOnboardingStep,
  type OnboardingStep,
} from "./onboardingFlow";
import {
  ENABLE_ONBOARDING_PARTICLES,
  ENABLE_SCREEN_CONTEXT,
} from "../config/featureFlags";
import { HOLD_DURATION_MS, DOUBLE_TAP_MS } from "../constants/gestures";
import { createLogger } from "../utils/logger";
import {
  panelCascadeContainer,
  panelCascadeItem,
} from "./shared/panelMotion";
// eslint-disable-next-line import/no-unresolved
import transparentLogoUrl from "/assets/transparent-wordmark.png?url";
// Development flags - only enabled in development mode
const isDevelopment = process.env.NODE_ENV === "development";
const devLog = createLogger("DEV");
const devNotifyLog = createLogger("DEV NOTIFY");
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
      if (isDevelopment) devLog.info(...args);
    },
    devNotify: (message: string) => {
      if (isDevelopment) devNotifyLog.info(message);
    },
  },
};

// Simple mock for now - starting in disabled state for UI development
const mockPermissions: PermissionProvider & { resetPermissions?: () => void } =
  {
    checkPermissions: async () => ({ needAX: true, needIM: true, isDev: true }),
    checkMicrophonePermission: async () => ({
      status: "denied",
      granted: false,
    }),
    requestMicrophonePermission: async () => ({ success: true, granted: true }),
    checkScreenRecordingPermission: async () => ({
      status: "denied",
      granted: false,
    }),
    requestScreenRecordingPermission: async () => ({
      success: true,
      granted: true,
    }),
    askIM: async () => ({ success: true, status: "authorized" }),
    requestAccessibilityPermission: async () => ({ success: true }),
    openSystemPreferences: () => undefined,
    resetPermissions: () => {
      if (isDevelopment) console.debug("[MockPermissions] resetPermissions");
    },
  };

const Onboarding: React.FC = () => {
  useLayoutEffect(() => {
    window.electron?.bootMark?.("onboarding-layout-effect");
    try {
      document.body.classList.remove("initial-fade");
    } catch {}
    try {
      window.electron?.rendererReady?.();
    } catch {}
  }, []);

  const introOnly =
    params.has("introOnly") || import.meta.env?.VITE_INTRO_ONLY === "1";
  const [showIntro, setShowIntro] = useState<boolean>(true);
  // Steps mount when the intro *begins* exiting (not when it finishes), so the
  // first step fades in while the intro fades out — a crossfade, not a gap.
  const [stepsRevealed, setStepsRevealed] = useState<boolean>(false);
  // Post-permissions auto-restart: relaunch so the OS applies the grants,
  // then resume at the next step. One-shot so it can't loop.
  const [autoRestarting, setAutoRestarting] = useState<boolean>(false);
  const autoRestartTriggeredRef = useRef(false);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("permissions");
  const shouldLoadTranscriptionSetup =
    !showIntro && currentStep === "transcription-setup";
  // Drives Next-gating and prewarm off the *active* model's live status: the
  // user installs a model in a card below, it becomes active + ready, and that
  // flips `transcriptionSetupReady`. `refresh` re-reads after the cards mutate
  // state (install/activate) so this status stays in sync with the active row.
  const {
    status: modelStatus,
    refresh: refreshModelStatus,
  } = useModelStatus({ enabled: shouldLoadTranscriptionSetup });
  // Permissions via shared hook (deduplicated across surfaces)
  const mockProvider: PermissionProvider | undefined =
    devFlags.mockPermissionStates
      ? {
          checkPermissions: mockPermissions.checkPermissions,
          checkMicrophonePermission: mockPermissions.checkMicrophonePermission,
          requestMicrophonePermission:
            mockPermissions.requestMicrophonePermission,
          checkScreenRecordingPermission:
            mockPermissions.checkScreenRecordingPermission,
          requestScreenRecordingPermission:
            mockPermissions.requestScreenRecordingPermission,
          askIM: mockPermissions.askIM,
          requestAccessibilityPermission:
            mockPermissions.requestAccessibilityPermission,
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
  } = usePermissions(mockProvider, {
    pollIntervalMs: 1000,
    deepLinkGraceMs: 4000,
    includeScreenRecording: ENABLE_SCREEN_CONTEXT,
  });
  const [isDev, setIsDev] = useState(false);
  const [pttApiReady, setPttApiReady] = useState(false);
  const [optKeyPressed, setOptKeyPressed] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const [testText, setTestText] = useState("");
  const [dictationChecklist, setDictationChecklist] = useState({
    pushToTalk: false,
    handsFree: false,
  });
  // Track mount state and timeout handles to prevent leaks
  const isMountedRef = useRef(true);
  const pttCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionDownAtRef = useRef<number | null>(null);
  const lastTapUpAtRef = useRef<number | null>(null);
  const activeDictationModeRef = useRef<"push-to-talk" | "hands-free" | null>(
    null,
  );
  const previousTestTextLengthRef = useRef(0);
  const localPrewarmRequestedRef = useRef(false);

  // Mic-check visualizer (Web Audio API capture + frequency analysis)
  const {
    barValues,
    micDevices,
    setMicDevices,
    selectedMicId,
    setSelectedMicId,
  } = useMicVisualizer({ active: currentStep === "mic-check" });
  // Reveal the first step the moment the intro starts exiting, so they overlap.
  const handleIntroExitStart = useCallback(() => {
    setStepsRevealed(true);
  }, []);
  // Dismiss intro without persisting any flag so it always shows next run.
  // Also guard stepsRevealed in case the intro finishes without firing exitStart.
  const handleIntroFinish = useCallback(() => {
    setStepsRevealed(true);
    setShowIntro(false);
  }, []);

  // Helper to render intro experience or replay button (for intro-only mode)
  const renderIntroOrReplay = () => {
    if (showIntro) {
      return (
        <IntroExperience
          logoSrc={transparentLogoUrl}
          onFinish={handleIntroFinish}
        />
      );
    }
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <button className="sf-intro-cta" onClick={() => setShowIntro(true)}>
          Replay intro
        </button>
      </div>
    );
  };
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

  // Save current step for mid-onboarding restart recovery
  useEffect(() => {
    if (introOnly) return; // Don't save in intro-only mode
    if (currentStep === "complete") return; // Don't save complete step

    window.electron?.setOnboardingStep?.(currentStep).catch((error) => {
      console.warn("[Onboarding] Failed to save current step:", error);
    });
  }, [currentStep, introOnly]);

  // Note: App location check moved to silent background check
  // No longer part of onboarding wizard flow

  // Initial permission check via shared hook
  useEffect(() => {
    // Mirror previous debug mode flag
    setIsDev(devFlags.isDevelopment);
  }, []);

  useEffect(() => {
    initPermissions();
  }, []);

  // Clear any active polling timers on unmount
  useEffect(() => {
    return () => {
      setOptKeyPressed(false); // Reset Option key state
      isMountedRef.current = false;
      if (pttCheckTimeoutRef.current) {
        clearTimeout(pttCheckTimeoutRef.current);
        pttCheckTimeoutRef.current = null;
      }
    };
  }, []);

  // Helper to get the current steps array
  const getSteps = (): OnboardingStep[] => buildOnboardingSteps();

  // Permission aggregates
  const allPermissionsGranted =
    permissions.microphone &&
    permissions.accessibility &&
    permissions.inputMonitoring &&
    (!ENABLE_SCREEN_CONTEXT || permissions.screenRecording);
  // Next on the transcription step gates on the *active* model being ready.
  // The cards below install/activate models; when the active one resolves to
  // "ready" this flips true. Nothing installed → not ready → Next stays
  // disabled (the deleted-models case).
  const transcriptionSetupReady = modelStatus.state === "ready";

  // The model cards (ModelsList) own their own install/activate state, so the
  // active-model status this step reads doesn't auto-update when a card
  // installs a model or switches the active one. Poll while the step is visible
  // so `transcriptionSetupReady` (Next-gating) and prewarm track the active row.
  useEffect(() => {
    if (currentStep !== "transcription-setup") return;
    const interval = setInterval(() => {
      void refreshModelStatus();
    }, 1000);
    return () => clearInterval(interval);
  }, [currentStep, refreshModelStatus]);

  useEffect(() => {
    if (currentStep !== "transcription-setup") return;
    if (modelStatus.state !== "ready") return;
    if (localPrewarmRequestedRef.current) return;

    localPrewarmRequestedRef.current = true;
    window.stt?.prewarmLocal?.().catch((error) => {
      localPrewarmRequestedRef.current = false;
      console.warn("[Onboarding] Failed to prewarm local model:", error);
    });
  }, [currentStep, modelStatus.state]);

  // Initialize provider settings and restore saved step
  useEffect(() => {
    if (introOnly) return;
    (async () => {
      // Check if there's a saved onboarding step (from mid-onboarding restart)
      try {
        const savedStep = await window.electron?.getOnboardingStep?.();
        const steps = buildOnboardingSteps();
        if (
          savedStep &&
          isOnboardingStep(savedStep) &&
          steps.includes(savedStep)
        ) {
          // Resuming a session already in progress (e.g. right after the
          // post-permissions auto-restart) — skip the intro and land directly
          // on the saved step so it "reopens from the next page".
          setShowIntro(false);
          setStepsRevealed(true);
          setCurrentStep(savedStep);
          return;
        }
      } catch {
        // Ignore errors - continue with default step
      }

      setCurrentStep("permissions");
    })();
  }, [introOnly]);

  // Start helper when entering the hotkey info step (after permissions) so Option key testing works
  useEffect(() => {
    if (currentStep === "hotkey-info" && !pttApiReady) {
      // Keep PTT routed to onboarding while the pill stays hidden so test taps
      // don't leak into the main app. Helper still runs so we can show keycaps.
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

  // Once every permission is granted, auto-restart: a relaunch is what makes
  // macOS actually apply the Accessibility / Input Monitoring grants. We persist
  // the next step first so onboarding reopens straight on it (intro skipped).
  useEffect(() => {
    if (introOnly || autoRestartTriggeredRef.current) return;
    if (currentStep !== "permissions" || !allPermissionsGranted) return;
    autoRestartTriggeredRef.current = true;
    const steps = buildOnboardingSteps();
    const nextStepAfterPermissions =
      steps[steps.indexOf("permissions") + 1] ?? "complete";

    // The relaunch is what makes macOS actually apply the Accessibility / Input
    // Monitoring grants in the packaged app. Under electron-forge (dev) a
    // relaunch doesn't respawn the app, so it would dead-end onboarding — just
    // advance to the next step instead.
    if (isDevelopment) {
      setCurrentStep(nextStepAfterPermissions);
      return;
    }

    setAutoRestarting(true);
    (async () => {
      try {
        await window.electron?.setOnboardingStep?.(nextStepAfterPermissions);
      } catch {
        /* ignore — resume will fall back to the permissions step */
      }
      // Brief, deliberate beat so the "Restarting…" moment reads, then relaunch.
      setTimeout(() => window.electron?.reloadApp?.(), 1600);
    })();
  }, [currentStep, allPermissionsGranted, introOnly]);

  // Navigation functions
  const nextStep = () => {
    const steps = getSteps();
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex < steps.length - 1) {
      // Reset Option key visual state when leaving hotkey pages
      if (currentStep === "hotkey-info" || currentStep === "hotkey-test") {
        setOptKeyPressed(false);
      }
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const prevStep = () => {
    const steps = getSteps();
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      // Reset Option key visual state when leaving hotkey pages
      if (currentStep === "hotkey-info" || currentStep === "hotkey-test") {
        setOptKeyPressed(false);
      }
      setCurrentStep(steps[currentIndex - 1]);
    }
  };

  // Prepare the pill (create main window + tray) when entering test steps
  const pillPreparedRef = useRef(false);
  useEffect(() => {
    if (currentStep === "hotkey-test" && !pillPreparedRef.current) {
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
    if (currentStep === "hotkey-test") {
      window.electron?.setPttTarget?.("main");
      // Reveal pill safely for test step (compact; main guarded against expansion)
      try {
        (window.electron as any)?.revealPillForTest?.();
      } catch {}
    }
  }, [currentStep]);

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
          .map((d) => ({
            id: d.deviceId || "default",
            label: d.label || "Microphone",
          }));
        const deduped = inputs.length
          ? inputs
          : [{ id: "default", label: "System Default" }];
        if (!cancelled) {
          setMicDevices(deduped);
          const next =
            seedId && deduped.some((d) => d.id === seedId)
              ? seedId
              : deduped[0]?.id;
          if (next) setSelectedMicId(next);
          try {
            window.mic?.updateDevices?.(
              deduped.map((d) => ({ id: d.id, label: d.label })),
              next || undefined,
            );
          } catch {}
        }
      } catch {
        if (!cancelled)
          setMicDevices([{ id: "default", label: "System Default" }]);
      }
    })();
    const off = window.mic?.onSelectedChanged?.(({ id }) => {
      try {
        if (id && id !== selectedMicId) setSelectedMicId(id);
      } catch {}
    });
    return () => {
      cancelled = true;
      try {
        off && off();
      } catch {}
    };
  }, [currentStep]);

  // Auto-focus the text box on test steps for better UX
  useEffect(() => {
    if (currentStep !== "hotkey-test") {
      return;
    }
    if (typeof window === "undefined") return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;

    const focusActiveTextArea = () => {
      if (cancelled) return;
      const active =
        textAreaRef.current?.dataset?.onboardingStep === currentStep
          ? textAreaRef.current
          : document.querySelector<HTMLTextAreaElement>(
              `textarea[data-onboarding-step="${currentStep}"]`,
            );

      if (!active) {
        timeoutId = setTimeout(focusActiveTextArea, 80);
        return;
      }

      textAreaRef.current = active;
      if (document.activeElement !== active) {
        try {
          active.focus({ preventScroll: true });
        } catch {
          active.focus();
        }
      }
    };

    rafId = window.requestAnimationFrame(focusActiveTextArea);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
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
      await window.electron?.onboardingComplete();
    } catch (error) {
      if (isDevelopment) console.error("Error completing onboarding:", error);
    }
    // Close immediately; no extra UX delay or audio fade here
    try {
      window.electron?.closeOnboarding?.();
    } catch (e) {
      /* ignore */
    }
  };

  // Step progress indicator
  // Returns the index among ['welcome','permissions','hotkey-test'], or -1 when not applicable
  const getProgressStepIndex = () => {
    const steps = getSteps();
    // Progress steps include welcome and exclude 'complete'
    const progressSteps = steps.slice(0, -1);
    return progressSteps.indexOf(currentStep);
  };

  const containerVariants: Variants = {
    hidden: { opacity: 0, y: 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.22,
        ease: "easeOut",
        delayChildren: 0.02,
        staggerChildren: 0.032,
      },
    },
    exit: {
      opacity: 0,
      y: -10,
      transition: { duration: 0.16, ease: "easeOut" },
    },
  };

  const showNavControls = !showIntro && currentStep !== "complete";
  const dictationTestReady =
    dictationChecklist.pushToTalk && dictationChecklist.handsFree;

  // --- Dictation test wiring for test steps ---
  useEffect(() => {
    if (currentStep === "hotkey-test") {
      setTestText("");
      setDictationChecklist({ pushToTalk: false, handsFree: false });
      activeDictationModeRef.current = null;
      previousTestTextLengthRef.current = 0;
    }
  }, [currentStep]);

  useEffect(() => {
    if (currentStep !== "hotkey-test") return;
    const nextLength = testText.trim().length;
    const previousLength = previousTestTextLengthRef.current;
    previousTestTextLengthRef.current = nextLength;

    if (nextLength <= previousLength) return;

    const mode = activeDictationModeRef.current;
    if (mode === "push-to-talk") {
      setDictationChecklist((prev) => ({ ...prev, pushToTalk: true }));
    } else if (mode === "hands-free") {
      setDictationChecklist((prev) => ({ ...prev, handsFree: true }));
    }
  }, [currentStep, testText]);

  // Option key visual feedback (no custom gesture handling)
  useEffect(() => {
    if (!window.ptt?.onDown || !window.ptt?.onUp) return;
    const offDown = window.ptt.onDown(() => {
      optionDownAtRef.current = Date.now();
      setOptKeyPressed(true);
    });
    const offUp = window.ptt.onUp(() => {
      const now = Date.now();
      const downAt = optionDownAtRef.current;
      optionDownAtRef.current = null;
      setOptKeyPressed(false);

      if (currentStep !== "hotkey-test") return;

      const heldMs = downAt ? now - downAt : 0;
      if (heldMs >= HOLD_DURATION_MS) {
        activeDictationModeRef.current = "push-to-talk";
        lastTapUpAtRef.current = null;
        return;
      }

      const lastTapUpAt = lastTapUpAtRef.current;
      if (lastTapUpAt && now - lastTapUpAt <= DOUBLE_TAP_MS) {
        activeDictationModeRef.current = "hands-free";
        lastTapUpAtRef.current = null;
      } else {
        lastTapUpAtRef.current = now;
      }
    });
    return () => {
      offDown?.();
      offUp?.();
      setOptKeyPressed(false);
    };
  }, [currentStep]);

  // Intro-only rendering path: show only the cinematic and a replay control
  if (introOnly) {
    return (
      <div className="flex flex-col h-full min-h-screen text-foreground onboarding-window relative">
        {renderIntroOrReplay()}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-screen text-foreground onboarding-window relative">
      {/* Grid and starfield backgrounds */}
      <GridBackground />
      {ENABLE_ONBOARDING_PARTICLES && <ParticlesCanvas />}

      {showIntro && (
        <IntroExperience
          logoSrc={transparentLogoUrl}
          onExitStart={handleIntroExitStart}
          onFinish={handleIntroFinish}
        />
      )}

      {/* Auto-restart moment after all permissions are granted */}
      {autoRestarting && (
        <m.div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="h-6 w-6 animate-spin will-change-transform rounded-full border-2 border-white/20 border-t-white/80" />
          <p className="text-sm text-foreground">
            You&apos;re all set. Restarting Spoke…
          </p>
        </m.div>
      )}
      {/* Native macOS traffic lights are now handled by Electron with titleBarStyle: 'hiddenInset' */}

      {/* Draggable Header Areas */}
      <div className="onboarding-header" />

      {/* Static top progress - glassy bars */}
      {currentStep !== "complete" && (
        <div className="absolute top-20 left-0 right-0 z-40 flex items-center justify-center pointer-events-none">
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
                      screenRecording: false,
                      accessibility: false,
                      inputMonitoring: false,
                    });
                    mockPermissions.resetPermissions?.();
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
        <div className="max-w-2xl w-full mx-auto flex-1 flex flex-col justify-center max-h-full overflow-y-auto p-6">
          {stepsRevealed && (
            <AnimatePresence mode="wait">
              {/* Hotkey Info Step */}
              {currentStep === "hotkey-info" && (
                <m.div
                  key="hotkey-info"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center"
                >
                  <div className="heading-stack">
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Meet Your Hotkey
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      Right Option starts dictation from anywhere on your Mac.
                    </p>
                  </div>
                  <div className="onboarding-section">
                    <div className="flex flex-col items-center justify-center">
                      <div
                        className={`keycap keycap-lg ${optKeyPressed ? "keycap-active" : ""}`}
                        aria-label={
                          optKeyPressed
                            ? "Option key active - recording in progress"
                            : "Option key - press and hold to start dictation"
                        }
                        aria-live="polite"
                      >
                        <span className="keycap-legend-top font-system">⌥</span>
                        <span className="keycap-legend-bottom font-system">
                          option
                        </span>
                      </div>
                      <p className="onboarding-note">
                        Press it here to check that Spoke can hear the key.
                      </p>
                    </div>
                  </div>
                  {/* Removed central Continue button; Next lives in bottom-right consistently */}
                </m.div>
              )}
              {/* Legacy welcome step removed (block fully deleted) */}

              {/* Combined Permissions Step */}
              {currentStep === "permissions" && (
                <m.div
                  key="permissions"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center"
                >
                  <m.div className="heading-stack" variants={panelCascadeItem}>
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Enable Required Permissions
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      Spoke needs these permissions to work.
                    </p>
                  </m.div>

                  <m.div
                    className="onboarding-section space-y-3"
                    variants={panelCascadeContainer}
                  >
                    {/* Microphone Permission */}
                    <m.div
                      variants={panelCascadeItem}
                      className={`onboarding-permission-row rounded-lg p-3 transition-opacity duration-300 ${permissions.microphone ? "opacity-60" : "opacity-100"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                            <SfIcon
                              name="microphone.fill"
                              size={16}
                              className="text-primary/70"
                            />
                          </div>
                          <div className="text-left">
                            <p className="text-[13px] font-medium text-foreground">
                              Voice Input
                            </p>
                            <p className="onboarding-permission-desc text-subtle">
                              Hear your voice to transcribe what you say.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center">
                          <div className="relative w-[84px] flex items-center justify-center">
                            <AnimatePresence mode="wait" initial={false}>
                              {!permissions.microphone ? (
                                <m.div
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
                                        <Spinner className="h-4 w-4" />
                                      ) : (
                                        <span>Enable</span>
                                      )}
                                    </div>
                                  </Button>
                                </m.div>
                              ) : (
                                <div className="flex items-center justify-center">
                                  <m.svg
                                    width="22"
                                    height="22"
                                    viewBox="0 0 24 24"
                                    className="text-white/80"
                                  >
                                    <m.path
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
                                  </m.svg>
                                </div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </div>
                      {/* No separate denied section; user can press Enable again. */}
                    </m.div>

                    {/* Accessibility Permission */}
                    <m.div
                      variants={panelCascadeItem}
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
                              Text Insertion
                            </p>
                            <p className="onboarding-permission-desc text-subtle">
                              Type text directly into any app for you.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center">
                          <div className="relative w-[84px] flex items-center justify-center">
                            <AnimatePresence mode="wait" initial={false}>
                              {!permissions.accessibility ? (
                                <m.div
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
                                        <Spinner className="h-4 w-4" />
                                      ) : (
                                        <span>Enable</span>
                                      )}
                                    </div>
                                  </Button>
                                </m.div>
                              ) : (
                                <div className="flex items-center justify-center">
                                  <m.svg
                                    width="22"
                                    height="22"
                                    viewBox="0 0 24 24"
                                    className="text-white/80"
                                  >
                                    <m.path
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
                                  </m.svg>
                                </div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </div>
                      {/* No separate denied section; user can press Enable again. */}
                    </m.div>

                    {/* Input Monitoring Permission */}
                    <m.div
                      variants={panelCascadeItem}
                      className={`onboarding-permission-row rounded-lg p-3 transition-opacity duration-300 ${permissions.inputMonitoring ? "opacity-60" : "opacity-100"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                            <SfIcon
                              name="keyboard.badge.eye.fill"
                              size={20}
                              className="text-primary/70"
                            />
                          </div>
                          <div className="text-left">
                            <p className="text-[13px] font-medium text-foreground">
                              Input Monitoring
                            </p>
                            <p className="onboarding-permission-desc text-subtle">
                              Listen for your hotkey from any app.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center">
                          <div className="relative w-[84px] flex items-center justify-center">
                            <AnimatePresence mode="wait" initial={false}>
                              {!permissions.inputMonitoring ? (
                                <m.div
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
                                        <Spinner className="h-4 w-4" />
                                      ) : (
                                        <span>Enable</span>
                                      )}
                                    </div>
                                  </Button>
                                </m.div>
                              ) : (
                                <div className="flex items-center justify-center">
                                  <m.svg
                                    width="22"
                                    height="22"
                                    viewBox="0 0 24 24"
                                    className="text-white/80"
                                  >
                                    <m.path
                                      initial={{
                                        pathLength: ui.inputMonitoring
                                          .justGranted
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
                                  </m.svg>
                                </div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </div>
                      {/* No separate denied section; user can press Enable again. */}
                    </m.div>

                    {/* Auto-restart note */}
                    <m.p
                      variants={panelCascadeItem}
                      className="text-xs text-muted-foreground/60 text-center pt-4"
                    >
                      Spoke restarts automatically once all permissions are on.
                    </m.p>
                  </m.div>
                </m.div>
              )}

              {/* Mic Check Step */}
              {currentStep === "mic-check" && (
                <m.div
                  key="mic-check"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center"
                >
                  <m.div className="heading-stack" variants={panelCascadeItem}>
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Let’s Check Your Microphone
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      Pick the right input and say a few words. The bars should
                      bounce.
                    </p>
                  </m.div>

                  <m.div
                    className="onboarding-section space-y-5"
                    variants={panelCascadeContainer}
                  >
                    {/* Mic selector */}
                    <m.div
                      className="mx-auto w-full max-w-xl"
                      variants={panelCascadeItem}
                    >
                      <Select
                        value={selectedMicId}
                        onValueChange={(v) => setSelectedMicId(v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select microphone" />
                        </SelectTrigger>
                        <SelectContent inPlace>
                          {micDevices.map((d) => (
                            <SelectItem
                              key={d.id}
                              value={d.id}
                              className="text-sm"
                            >
                              {d.label || "Microphone"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </m.div>

                    <m.div
                      className="flex items-center justify-center py-3"
                      variants={panelCascadeItem}
                    >
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
                    </m.div>
                  </m.div>
                </m.div>
              )}

              {/* Transcription Setup Step */}
              {currentStep === "transcription-setup" && (
                <m.div
                  key="transcription-setup"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center"
                >
                  <m.div className="heading-stack" variants={panelCascadeItem}>
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Install Local Model
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      Spoke transcribes on-device, so your voice is processed
                      locally instead of by a transcription server.
                    </p>
                  </m.div>

                  <m.div
                    className="onboarding-section space-y-2"
                    variants={panelCascadeContainer}
                  >
                    {/* The same model list the Settings → Models page renders,
                        as standalone (non-grouped) cards so the two models read
                        as two distinct cards stacked with a gap. Each card shows
                        its real install state and doubles as install + activate:
                        download glyph when not installed, bright check when
                        active, dim check (brightens on hover, click to activate)
                        when installed-but-inactive. Installing one and making it
                        active is what flips this step's Next on. */}
                    <ModelsList
                      enabled={shouldLoadTranscriptionSetup}
                      inGroup={false}
                    />
                  </m.div>
                </m.div>
              )}

              {/* Hotkey Test Step */}
              {currentStep === "hotkey-test" && (
                <m.div
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
                        Try Dictation Modes
                      </h2>
                      <p className="text-sm text-subtle leading-relaxed subheading">
                        Hold the hotkey for quick notes, or double tap when you
                        want to speak hands-free.
                      </p>
                    </div>
                    <div className="onboarding-section space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div
                          className={`onboarding-task-row h-full rounded-lg p-3 ${
                            dictationChecklist.pushToTalk
                              ? "onboarding-task-complete"
                              : ""
                          }`}
                        >
                          <div className="flex h-full items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-foreground">
                                Push-to-talk
                              </p>
                              <p className="onboarding-permission-desc text-subtle">
                                Hold Right Option while speaking, then release
                                to insert.
                              </p>
                            </div>
                            <div className="onboarding-task-status">
                              <AnimatePresence mode="wait" initial={false}>
                                {dictationChecklist.pushToTalk ? (
                                  <m.svg
                                    key="push-to-talk-done"
                                    width="22"
                                    height="22"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    className="text-white/80"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                  >
                                    <m.path
                                      initial={{ pathLength: 0 }}
                                      animate={{ pathLength: 1 }}
                                      transition={{
                                        duration: 0.45,
                                        ease: [0.25, 0.8, 0.25, 1],
                                      }}
                                      d="M5 13l4 4L19 7"
                                      stroke="currentColor"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </m.svg>
                                ) : (
                                  <m.span
                                    key="push-to-talk-try"
                                    className="onboarding-task-prompt"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    aria-hidden
                                  >
                                    Try
                                  </m.span>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        </div>

                        <div
                          className={`onboarding-task-row h-full rounded-lg p-3 ${
                            dictationChecklist.handsFree
                              ? "onboarding-task-complete"
                              : ""
                          }`}
                        >
                          <div className="flex h-full items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-foreground">
                                Hands-free
                              </p>
                              <p className="onboarding-permission-desc text-subtle">
                                Double tap Right Option to start. Tap again to
                                stop.
                              </p>
                            </div>
                            <div className="onboarding-task-status">
                              <AnimatePresence mode="wait" initial={false}>
                                {dictationChecklist.handsFree ? (
                                  <m.svg
                                    key="hands-free-done"
                                    width="22"
                                    height="22"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    className="text-white/80"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                  >
                                    <m.path
                                      initial={{ pathLength: 0 }}
                                      animate={{ pathLength: 1 }}
                                      transition={{
                                        duration: 0.45,
                                        ease: [0.25, 0.8, 0.25, 1],
                                      }}
                                      d="M5 13l4 4L19 7"
                                      stroke="currentColor"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </m.svg>
                                ) : (
                                  <m.span
                                    key="hands-free-try"
                                    className="onboarding-task-prompt"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    aria-hidden
                                  >
                                    Try
                                  </m.span>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="onboarding-content-gap">
                        <textarea
                          className={
                            "w-full h-32 resize-none onboarding-textarea px-4 py-4 text-sm outline-none overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 hover:scrollbar-thumb-white/30"
                          }
                          placeholder="Your dictated text will appear here…"
                          value={testText}
                          onChange={(e) => setTestText(e.target.value)}
                          ref={textAreaRef}
                          data-onboarding-step="hotkey-test"
                        />
                      </div>
                    </div>
                  </div>
                </m.div>
              )}

              {/* Complete Step */}
              {currentStep === "complete" && (
                <m.div
                  key="complete"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center space-y-4"
                >
                  {/* Checkmark badge - matches waitlist modal */}
                  <m.div
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
                      <m.path
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
                  </m.div>
                  <h2 className="text-heading-xl heading-gradient heading-crisp text-breathe">
                    You're all set
                  </h2>
                  <p className="text-sm text-subtle leading-relaxed">
                    It's been a pleasure onboarding you. You can now start
                    dictating.
                  </p>
                  <div className="pt-2 flex justify-center">
                    <Button
                      onClick={handleComplete}
                      className="onboarding-cta shimmer"
                    >
                      Start Dictating
                    </Button>
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* Navigation Controls */}
        {showNavControls && (
          <div className="absolute bottom-6 left-6 right-6 flex justify-between">
            <Button
              variant="secondary"
              onClick={prevStep}
              disabled={getProgressStepIndex() <= 0}
            >
              Back
            </Button>

            <Button
              variant="secondary"
              onClick={() => {
                nextStep();
              }}
              disabled={
                (currentStep === "permissions" && !allPermissionsGranted) ||
                (currentStep === "transcription-setup" &&
                  !transcriptionSetupReady) ||
                (currentStep === "hotkey-test" && !dictationTestReady)
              }
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
