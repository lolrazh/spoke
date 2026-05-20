import React, { useState, useEffect, useRef, useCallback } from "react";
import IntroExperience from "./intro/IntroExperience";
import { ParticlesCanvas } from "./shared/ParticlesCanvas";
import { GridBackground } from "./shared/GridBackground";
import { useMicVisualizer } from "../hooks/useMicVisualizer";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "./ui/select";
import SfIcon from "./icons/SfIcon";
import TricksComponent from "./meta/MetaDirectivesComponent";
import {
  usePermissions,
  type PermissionProvider,
} from "../hooks/usePermissions";
import { useProviderSelection } from "../hooks/useProviderSelection";
import { useModelStatus } from "../hooks/useModelStatus";
import {
  LOCAL_STT_PROVIDER_ID,
  type PreferredTranscriptionProviderId,
} from "../core/transcription/providerPreferences";
import {
  buildOnboardingSteps,
  isOnboardingStep,
  type OnboardingStep,
} from "./onboardingFlow";
import {
  ENABLE_ONBOARDING_PARTICLES,
  ENABLE_SCREEN_CONTEXT,
} from "../config/featureFlags";
// eslint-disable-next-line import/no-unresolved
import onboardingMusicUrl from "/assets/onboarding-music.wav?url";
// eslint-disable-next-line import/no-unresolved
import transparentLogoUrl from "/assets/transparent-wordmark.png?url";
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

// TapRipple component for settings demo
const TapRipple: React.FC<{
  delay: number; // delay in seconds within the 3s loop
  top: string;
  left: string;
}> = ({ delay, top, left }) => {
  return (
    <motion.div
      className="absolute rounded-full border border-white/35"
      style={{
        width: "24px",
        height: "24px",
        top,
        left,
        transform: "translate(-50%, -50%)",
        background: "transparent",
        zIndex: 10,
      }}
      initial={{ scale: 0.3, opacity: 0 }}
      animate={{
        scale: [0.3, 1.2, 2.0, 2.0, 0.3],
        opacity: [0, 0.6, 0.15, 0, 0],
      }}
      transition={{
        duration: 3,
        ease: "easeOut",
        times: [0, 0.05, 0.1, 0.15, 1],
        repeat: Infinity,
        delay: delay,
      }}
    />
  );
};

const Onboarding: React.FC = () => {
  const introOnly =
    params.has("introOnly") || import.meta.env?.VITE_INTRO_ONLY === "1";
  const [showIntro, setShowIntro] = useState<boolean>(true);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("permissions");
  const {
    setProviderSettings,
    loadProviderSettings,
    selectableProviderEntries,
    selectedProviderId,
    selectedProviderEntry,
  } = useProviderSelection();
  const {
    status: modelStatus,
    install: installModel,
    refresh: refreshModelStatus,
  } = useModelStatus();
  const [introControlsReady, setIntroControlsReady] = useState<boolean>(false);
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
  const [cmdKeyPressed, setCmdKeyPressed] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const [testText, setTestText] = useState("");
  const [testTextTap, setTestTextTap] = useState("");
  // Track mount state and timeout handles to prevent leaks
  const isMountedRef = useRef(true);
  const pttCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mic-check visualizer (Web Audio API capture + frequency analysis)
  const {
    barValues,
    micDevices,
    setMicDevices,
    selectedMicId,
    setSelectedMicId,
  } = useMicVisualizer({ active: currentStep === "mic-check" });
  // Background music during onboarding
  const onboardingAudioRef = useRef<HTMLAudioElement | null>(null);
  const [musicEnabled, setMusicEnabled] = useState<boolean>(true);
  const targetMusicVolumeRef = useRef<number>(0.28);
  const fadeRafRef = useRef<number | null>(null);

  // Reusable volume fade helper
  const fadeVolumeTo = (to: number, durationMs = 600) =>
    new Promise<void>((resolve) => {
      const audio = onboardingAudioRef.current;
      if (!audio || durationMs <= 0) {
        if (audio) audio.volume = Math.max(0, Math.min(1, to));
        resolve();
        return;
      }
      if (fadeRafRef.current) {
        cancelAnimationFrame(fadeRafRef.current);
        fadeRafRef.current = null;
      }
      const from = audio.volume;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const v = from + (to - from) * t;
        audio.volume = Math.max(0, Math.min(1, v));
        if (t < 1) {
          fadeRafRef.current = requestAnimationFrame(step);
        } else {
          if (fadeRafRef.current) {
            cancelAnimationFrame(fadeRafRef.current);
            fadeRafRef.current = null;
          }
          resolve();
        }
      };
      fadeRafRef.current = requestAnimationFrame(step);
    });
  // Dismiss intro without persisting any flag so it always shows next run
  const handleIntroFinish = useCallback(() => {
    setShowIntro(false);
  }, []);

  // Ensure we reset the controls ready flag when replaying the intro
  useEffect(() => {
    if (showIntro) setIntroControlsReady(false);
  }, [showIntro]);

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
  // Sample prompts for tests
  const sampleEditText =
    "I wanna show you how Spoke actually helps, how Spoke actually behaves and why Spoke is better than the other apps.";

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

  // Setup onboarding background music (autoplay + loop)
  useEffect(() => {
    const audio = new Audio(onboardingMusicUrl);
    onboardingAudioRef.current = audio;
    audio.loop = true;
    audio.volume = targetMusicVolumeRef.current; // subtle by default

    const tryPlay = async () => {
      try {
        await audio.play();
        setMusicEnabled(true);
      } catch {
        // Autoplay might be blocked; keep disabled until user toggles
        setMusicEnabled(false);
      }
    };

    // Try to start immediately
    tryPlay();

    return () => {
      try {
        audio.pause();
        audio.src = "";
      } catch {}
      onboardingAudioRef.current = null;
    };
  }, []);

  // Fade out audio upon entering mic-check, then pause and mark disabled
  useEffect(() => {
    if (currentStep !== "mic-check") return;
    (async () => {
      try {
        if (
          onboardingAudioRef.current &&
          !onboardingAudioRef.current.paused &&
          onboardingAudioRef.current.volume > 0
        ) {
          await fadeVolumeTo(0, 800);
          onboardingAudioRef.current.pause();
          setMusicEnabled(false);
        }
      } catch {}
    })();
  }, [currentStep]);

  // Save current step for mid-onboarding restart recovery
  useEffect(() => {
    if (introOnly) return; // Don't save in intro-only mode
    if (currentStep === "complete") return; // Don't save complete step

    window.electron?.setOnboardingStep?.(currentStep).catch((error) => {
      console.warn("[Onboarding] Failed to save current step:", error);
    });
  }, [currentStep, introOnly]);

  const toggleMusic = () => {
    const audio = onboardingAudioRef.current;
    if (!audio) return;
    const nextEnabled = !musicEnabled;
    // Flip UI state immediately for reactive icon change
    setMusicEnabled(nextEnabled);
    if (nextEnabled) {
      // Enable: start playback silently, then fade up asynchronously
      (async () => {
        try {
          audio.volume = 0;
          await audio.play();
          await fadeVolumeTo(targetMusicVolumeRef.current, 600);
        } catch {
          // Revert UI if play fails
          setMusicEnabled(false);
        }
      })();
    } else {
      // Disable: fade down asynchronously, then pause
      (async () => {
        try {
          await fadeVolumeTo(0, 600);
        } catch {}
        try {
          audio.pause();
        } catch {}
      })();
    }
  };

  // Speaker icon with fixed box and crossfade to avoid jumps
  const SpeakerToggleIcon: React.FC<{ enabled: boolean }> = ({ enabled }) => {
    const prevEnabledRef = useRef<boolean>(enabled);
    const [showSlashOverlay, setShowSlashOverlay] = useState<boolean>(false);
    const [drawForward, setDrawForward] = useState<boolean>(false);

    useEffect(() => {
      const was = prevEnabledRef.current;
      if (was !== enabled) {
        // Trigger slash draw overlay on transitions
        if (!enabled) {
          // going from on -> off: draw in
          setDrawForward(true);
          setShowSlashOverlay(true);
          const t = setTimeout(() => setShowSlashOverlay(false), 260);
          return () => clearTimeout(t);
        } else {
          // off -> on: draw out
          setDrawForward(false);
          setShowSlashOverlay(true);
          const t = setTimeout(() => setShowSlashOverlay(false), 220);
          return () => clearTimeout(t);
        }
      }
      prevEnabledRef.current = enabled;
    }, [enabled]);

    return (
      <div className="relative w-7 h-7 flex items-center justify-center">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={enabled ? "on" : "off"}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <SfIcon
              name={enabled ? "speaker.wave.3.fill" : "speaker.slash.fill"}
              size={22}
            />
          </motion.div>
        </AnimatePresence>

        {showSlashOverlay && (
          <motion.svg
            className="absolute inset-0"
            width={22}
            height={22}
            viewBox="0 0 41.29296875 48.146484375"
            preserveAspectRatio="xMidYMid meet"
            fill="none"
            stroke="currentColor"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <motion.path
              d="M 37.060546875 4.94140625 L 3.416015625 39.359375"
              initial={{ pathLength: drawForward ? 0 : 1, opacity: 0.9 }}
              animate={{ pathLength: drawForward ? 1 : 0, opacity: 0.9 }}
              transition={{
                duration: drawForward ? 0.24 : 0.2,
                ease: "easeOut",
              }}
            />
          </motion.svg>
        )}
      </div>
    );
  };

  // Note: App location check moved to silent background check
  // No longer part of onboarding wizard flow

  // Initial permission check via shared hook
  useEffect(() => {
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
      setOptKeyPressed(false); // Reset Option key state
      setCmdKeyPressed(false);
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
  const localProviderSelected = selectedProviderId === LOCAL_STT_PROVIDER_ID;
  const transcriptionSetupReady =
    !localProviderSelected || modelStatus.state === "ready";
  const modelInstallBusy =
    modelStatus.state === "downloading" || modelStatus.state === "installing";
  const modelProgressPercent = Math.round(modelStatus.downloadProgress * 100);
  const transcriptionProviderOptions =
    selectableProviderEntries.length > 0
      ? selectableProviderEntries.map((provider) => ({
          value: provider.id,
          label: provider.displayName,
        }))
      : [{ value: LOCAL_STT_PROVIDER_ID, label: "Local" }];

  const handleInstallModel = async () => {
    await installModel();
    await refreshModelStatus();
    try {
      setProviderSettings(await loadProviderSettings());
    } catch {
      // Provider settings are best-effort here; model status is the source of truth.
    }
  };

  // Initialize provider settings and restore saved step
  useEffect(() => {
    if (introOnly) return;
    (async () => {
      const snapshot = await loadProviderSettings();
      if (isMountedRef.current) {
        setProviderSettings(snapshot);
      }

      // Check if there's a saved onboarding step (from mid-onboarding restart)
      try {
        const savedStep = await window.electron?.getOnboardingStep?.();
        const steps = buildOnboardingSteps();
        if (
          savedStep &&
          isOnboardingStep(savedStep) &&
          steps.includes(savedStep)
        ) {
          setCurrentStep(savedStep);
          return;
        }
      } catch {
        // Ignore errors - continue with default step
      }

      setCurrentStep("permissions");
    })();
  }, [introOnly, loadProviderSettings]);

  const handleProviderChange = useCallback(
    async (providerId: string) => {
      try {
        await window.stt?.setPreferredProvider?.(
          providerId as PreferredTranscriptionProviderId,
        );
        const snapshot = await loadProviderSettings();
        if (isMountedRef.current) {
          setProviderSettings(snapshot);
        }
      } catch (error) {
        console.error(
          "[Onboarding] Failed to switch transcription provider:",
          error,
        );
        window.notifications?.send?.(
          "Failed to switch transcription provider.",
        );
      }
    },
    [loadProviderSettings, setProviderSettings],
  );

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
    if (
      currentStep !== "hotkey-test"
    ) {
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

  // Animation variants (with dev speed control)
  const spring = devFlags.fastAnimations
    ? { type: "spring" as const, stiffness: 420, damping: 30, mass: 0.35 }
    : { type: "spring" as const, stiffness: 340, damping: 28, mass: 0.45 };
  const containerVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: spring },
    exit: { opacity: 0, y: -16, transition: spring },
  };

  const showNavControls = !showIntro && currentStep !== "complete";

  // --- Dictation test wiring for test steps ---
  useEffect(() => {
    if (currentStep === "hotkey-test") {
      setTestText("");
    } else if (currentStep === "edit-test") {
      setTestTextTap(sampleEditText);
    }
  }, [currentStep]);

  // Option key visual feedback (no custom gesture handling)
  useEffect(() => {
    if (!window.ptt?.onDown || !window.ptt?.onUp) return;
    const offDown = window.ptt.onDown(() => setOptKeyPressed(true));
    const offUp = window.ptt.onUp(() => setOptKeyPressed(false));
    return () => {
      offDown?.();
      offUp?.();
      setOptKeyPressed(false);
    };
  }, []);

  // Hook: Right Command visual feedback on cancel-info step only
  useEffect(() => {
    if (currentStep !== "cancel-info") {
      setCmdKeyPressed(false);
      return;
    }
    const cleanups: Array<() => void> = [];
    if (window.ptt?.onCancelDown) {
      cleanups.push(window.ptt.onCancelDown(() => setCmdKeyPressed(true)));
    }
    if (window.ptt?.onCancel) {
      cleanups.push(
        window.ptt.onCancel(() => {
          setCmdKeyPressed(false);
        }),
      );
    }
    return () => {
      cleanups.forEach((fn) => fn && fn());
      setCmdKeyPressed(false);
    };
  }, [currentStep]);

  // Intro-only rendering path: show only the cinematic and a replay control
  if (introOnly) {
    return (
      <div className="flex flex-col h-full min-h-screen text-foreground onboarding-window relative">
        {renderIntroOrReplay()}
        {/* Speaker toggle - top-right, ghost style matching chevron */}
        <button
          className="pill-collapse-btn sf-intro-controls absolute top-4 right-4 no-drag"
          onClick={toggleMusic}
          aria-label={
            musicEnabled ? "Mute onboarding music" : "Unmute onboarding music"
          }
          title={musicEnabled ? "Mute music" : "Unmute music"}
        >
          <SpeakerToggleIcon enabled={musicEnabled} />
        </button>
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
          onFinish={handleIntroFinish}
          onReadyForControls={() => setIntroControlsReady(true)}
        />
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

      {/* Speaker toggle - show before mic-check only */}
      {(showIntro || currentStep === "permissions") && (
        <AnimatePresence initial={false}>
          {(showIntro ? introControlsReady : true) && (
            <motion.button
              key={showIntro ? "intro-toggle" : "onboarding-toggle"}
              className="pill-collapse-btn sf-intro-controls absolute top-4 right-4 no-drag"
              onClick={toggleMusic}
              aria-label={
                musicEnabled
                  ? "Mute onboarding music"
                  : "Unmute onboarding music"
              }
              title={musicEnabled ? "Mute music" : "Unmute music"}
              initial={{ opacity: 0, scale: 0.9, y: -2, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.95, y: -2, filter: "blur(2px)" }}
              transition={{ duration: 0.5, ease: [0.25, 0.8, 0.25, 1] }}
            >
              <SpeakerToggleIcon enabled={musicEnabled} />
            </motion.button>
          )}
        </AnimatePresence>
      )}

      {/* Close Button removed per design */}

      {/* Main Content - Single Column */}
      <div className="flex-1 flex flex-col justify-center p-6 pt-10 relative min-h-0 overflow-hidden">
        <div className="max-w-2xl w-full mx-auto flex-1 flex flex-col justify-center max-h-full overflow-y-auto p-6">
          {!showIntro && (
            <AnimatePresence mode="wait">
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
                      Your Hotkey Is the Right Option Key
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      Press your Right Option key now to test it.
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
                        Hold for push-to-talk, double tap for hands-free mode.
                      </p>
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
                  className="text-center"
                >
                  <div className="heading-stack">
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Enable Required Permissions
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      Spoke needs these permissions to work.
                    </p>
                  </div>

                  <div className="onboarding-section space-y-3">
                    {/* Microphone Permission */}
                    <div
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

                    {/* Input Monitoring Permission */}
                    <div
                      className={`onboarding-permission-row rounded-lg p-3 transition-opacity duration-300 ${permissions.inputMonitoring ? "opacity-60" : "opacity-100"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                            <SfIcon
                              name="keyboard"
                              size={16}
                              className="text-primary/70"
                            />
                          </div>
                          <div className="text-left">
                            <p className="text-[13px] font-medium text-foreground">
                              Global Hotkey
                            </p>
                            <p className="onboarding-permission-desc text-subtle">
                              Listen for your dictation shortcut from any app.
                            </p>
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
                                  </motion.svg>
                                </div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </div>
                      {/* No separate denied section; user can press Enable again. */}
                    </div>

                    {/* Restart hint */}
                    <p className="text-xs text-muted-foreground/60 text-center pt-4">
                      You may need to restart Spoke after enabling permissions.
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Mic Check Step */}
              {currentStep === "mic-check" && (
                <motion.div
                  key="mic-check"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center"
                >
                  <div className="heading-stack">
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Let’s Check Your Microphone
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      Pick the right input and say a few words. The bars should
                      bounce.
                    </p>
                  </div>

                  <div className="onboarding-section space-y-5">
                    {/* Mic selector */}
                    <div className="mx-auto w-full max-w-xl">
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
                  </div>
                </motion.div>
              )}

              {/* Transcription Setup Step */}
              {currentStep === "transcription-setup" && (
                <motion.div
                  key="transcription-setup"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center"
                >
                  <div className="heading-stack">
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Choose Your Transcription Engine
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      Use the local Whisper model for private offline
                      transcription, or switch to a configured cloud provider.
                    </p>
                  </div>

                  <div className="onboarding-section space-y-3">
                    <div className="onboarding-permission-row rounded-lg p-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                            <SfIcon
                              name="point.3.filled.connected.trianglepath.dotted"
                              size={16}
                              className="text-primary/70"
                            />
                          </div>
                          <div className="text-left">
                            <p className="text-[13px] font-medium text-foreground">
                              Default engine
                            </p>
                            <p className="onboarding-permission-desc text-subtle">
                              {selectedProviderEntry?.description ??
                                "Offline transcription with the local Whisper model."}
                            </p>
                          </div>
                        </div>
                        <div className="w-40 shrink-0">
                          <Select
                            value={selectedProviderId}
                            onValueChange={handleProviderChange}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Provider" />
                            </SelectTrigger>
                            <SelectContent inPlace>
                              {transcriptionProviderOptions.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                  className="text-sm"
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    {localProviderSelected && (
                      <div className="onboarding-permission-row rounded-lg p-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                              <SfIcon
                                name="brain.head.profile"
                                size={16}
                                className="text-primary/70"
                              />
                            </div>
                            <div className="text-left">
                              <p className="text-[13px] font-medium text-foreground">
                                Whisper large-v3 turbo 4-bit
                              </p>
                              <p className="onboarding-permission-desc text-subtle">
                                {modelStatus.state === "ready"
                                  ? "Installed and ready for offline dictation."
                                  : modelStatus.state === "broken"
                                    ? modelStatus.error ||
                                      "The local model needs to be repaired."
                                    : modelInstallBusy
                                      ? "Installing the local transcription model."
                                      : "Install once to use Spoke without a cloud STT key."}
                              </p>
                            </div>
                          </div>

                          <div className="flex min-w-[112px] items-center justify-end">
                            {modelStatus.state === "ready" ? (
                              <motion.svg
                                width="22"
                                height="22"
                                viewBox="0 0 24 24"
                                className="text-white/80"
                              >
                                <motion.path
                                  initial={{ pathLength: 1 }}
                                  animate={{ pathLength: 1 }}
                                  d="M5 13l4 4L19 7"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </motion.svg>
                            ) : modelInstallBusy ? (
                              <div className="w-28 space-y-1.5">
                                <div className="text-[10px] text-white/70 tabular-nums">
                                  {modelStatus.state === "installing"
                                    ? "Verifying"
                                    : `${modelProgressPercent}%`}
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                                  <div
                                    className="h-full rounded-full bg-white/60 transition-all duration-300"
                                    style={{
                                      width: `${modelProgressPercent}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                onClick={handleInstallModel}
                                className="text-xs onboarding-cta"
                              >
                                {modelStatus.state === "broken"
                                  ? "Repair"
                                  : "Install"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground/60 text-center pt-2">
                      Cloud providers use your own API keys. Add or manage keys
                      later from Settings &gt; Models.
                    </p>
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
                        Let's Try Push-to-Talk Mode
                      </h2>
                      <p className="text-sm text-subtle leading-relaxed subheading">
                        Hold the hotkey to start dictation. Release to stop.
                      </p>
                    </div>
                    <div className="onboarding-section">
                      {/* Sample hint as tertiary text for improved hierarchy */}
                      <div className="onboarding-hint onboarding-hint-centered text-dimmed">
                        Try saying: "Let's go! I'm so excited to use Spoke!
                        Write all of that in caps."
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
                          data-onboarding-step="hotkey-test"
                        />
                      </div>

                      {/* No CTA here; proceed with Next to the completion screen */}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Hands-Free Test Step */}
              {currentStep === "hands-free-test" && (
                <motion.div
                  key="hands-free-test"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center overflow-hidden"
                >
                  <div className="max-w-xl mx-auto text-left">
                    <div className="text-center heading-stack">
                      <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                        Let's Try Hands-Free Mode
                      </h2>
                      <p className="text-sm text-subtle leading-relaxed subheading">
                        Double tap the hotkey to start dictation. Tap again to
                        stop.
                      </p>
                    </div>
                    <div className="onboarding-section">
                      {/* Sample hint as tertiary text for improved hierarchy */}
                      <div className="onboarding-hint onboarding-hint-centered text-dimmed">
                        Try saying: "Look mom, no hands! Tag mom with an at
                        symbol. And show excitement."
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
                          data-onboarding-step="hands-free-test"
                        />
                      </div>

                      {/* No CTA here; proceed with Next to the completion screen */}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Edit Test Step */}
              {currentStep === "edit-test" && (
                <motion.div
                  key="edit-test"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center overflow-hidden"
                >
                  <div className="max-w-xl mx-auto text-left">
                    <div className="text-center heading-stack">
                      <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                        Let's Try Edit Mode
                      </h2>
                      <p className="text-sm text-subtle leading-relaxed subheading">
                        Select the text, hold the hotkey and give it
                        instructions.
                      </p>
                    </div>
                    <div className="onboarding-section">
                      {/* Sample hint as tertiary text for improved hierarchy */}
                      <div className="onboarding-hint onboarding-hint-centered text-dimmed">
                        Try saying: "Can you write how and why in caps."
                      </div>

                      {/* Dictation Textarea with pre-filled content */}
                      <div className="onboarding-content-gap">
                        <textarea
                          className={
                            "w-full h-32 resize-none onboarding-textarea px-4 py-4 text-sm outline-none overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 hover:scrollbar-thumb-white/30"
                          }
                          placeholder="Select some text and try editing it..."
                          value={testTextTap}
                          onChange={(e) => setTestTextTap(e.target.value)}
                          ref={textAreaRef}
                          data-onboarding-step="edit-test"
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Meta-Directives Step */}
              {currentStep === "meta-directives" && (
                <motion.div
                  key="meta-directives"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center"
                >
                  <TricksComponent />
                </motion.div>
              )}

              {/* Cancel Info Step */}
              {currentStep === "cancel-info" && (
                <motion.div
                  key="cancel-info"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center"
                >
                  <div className="heading-stack">
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Your Cancel Key Is the Right Command Key
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      Press your Right Command key now to test it.
                    </p>
                  </div>
                  <div className="onboarding-section">
                    <div className="flex flex-col items-center justify-center">
                      <div
                        className={`keycap keycap-lg keycap-wide ${cmdKeyPressed ? "keycap-active" : ""}`}
                        aria-label={"Command key - press to cancel dictation"}
                        aria-live="polite"
                      >
                        <span className="keycap-legend-top font-system">⌘</span>
                        <span className="keycap-legend-bottom font-system">
                          command
                        </span>
                      </div>
                      <p className="onboarding-note">
                        You can tap this key any time to cancel dictation.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Settings Info Step */}
              {currentStep === "settings-info" && (
                <motion.div
                  key="settings-info"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center"
                >
                  <div className="heading-stack">
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                      Quick Access to Settings
                    </h2>
                    <p className="text-sm text-subtle leading-relaxed subheading">
                      Double-click the island anytime to open settings.
                    </p>
                  </div>
                  <div className="onboarding-section flex flex-col items-center justify-center">
                    {/* Screen outline container */}
                    <div className="relative w-[320px] h-[200px] rounded-lg border-2 border-white/10 flex items-start justify-center pt-1">
                      {/* Pill container - positioned at top like real macOS island */}
                      <div className="relative">
                        {/* First ripple */}
                        <TapRipple
                          delay={0}
                          top="calc(50% - 11px)"
                          left="calc(50% - 11px)"
                        />
                        {/* Second ripple */}
                        <TapRipple
                          delay={0.2}
                          top="calc(50% - 11px)"
                          left="calc(50% - 11px)"
                        />
                        {/* Close tap ripple */}
                        <TapRipple
                          delay={1.26}
                          top="calc(100% - 19px)"
                          left="calc(50% - 11px)"
                        />
                        {/* Pill shape - single stroke line that expands to settings */}
                        <motion.div
                          className="relative bg-white/10 border border-white/20 backdrop-blur-sm"
                          style={{
                            borderRadius: "1.5px",
                          }}
                          initial={{ width: "35px", height: "3px" }}
                          animate={{
                            width: ["35px", "35px", "100px", "100px", "35px"],
                            height: ["3px", "3px", "117px", "117px", "3px"],
                            borderRadius: [
                              "1.5px",
                              "1.5px",
                              "4px",
                              "4px",
                              "1.5px",
                            ],
                          }}
                          transition={{
                            duration: 3.0,
                            ease: [0.25, 0.8, 0.25, 1],
                            times: [0, 0.17, 0.33, 0.5, 0.67], // Hold at rest, expand, hold expanded, contract, hold resting
                            repeat: Infinity,
                          }}
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
                </motion.div>
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
                (currentStep === "hotkey-test" && !testText.trim())
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
