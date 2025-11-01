import React, { useState, useEffect, useRef } from "react";
import IntroExperience from "./intro/IntroExperience";
import { ParticlesCanvas } from "./shared/ParticlesCanvas";
import { GridBackground } from "./shared/GridBackground";
import { markOnboardingEvent } from "../utils/authSignals";
import { AUDIO_PROCESSING_TRACK_CONSTRAINTS } from "../config/audioConstraints";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Button } from "./ui/button";
import { Avatar } from "./ui/avatar";
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
  getSupabase,
  getGoogleOAuthUrl,
  startEmailOtp,
  handleAuthCallbackUrl,
  getCurrentUser,
  getProfile,
  markOnboardingDone,
  ensureProfileRow,
  signOut,
} from "../lib/supabaseClient";
import { usePermissions, type PermissionProvider } from "../hooks/usePermissions";
// eslint-disable-next-line import/no-unresolved
import onboardingMusicUrl from "/assets/onboarding-music.wav?url";
// eslint-disable-next-line import/no-unresolved
import transparentLogoUrl from "/assets/transparent-logo-w-text.png?url";
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

const AUTH_EASE_VISIBLE: [number, number, number, number] = [
  0.25,
  0.8,
  0.25,
  1,
];
const AUTH_EASE_EXIT: [number, number, number, number] = [0.4, 0, 0.2, 1];

// Simple mock for now - starting in disabled state for UI development
const mockPermissions: PermissionProvider & { resetPermissions?: () => void } = {
  checkPermissions: async () => ({ needAX: true, needIM: true, isDev: true }),
  checkMicrophonePermission: async () => ({ status: "denied", granted: false }),
  requestMicrophonePermission: async () => ({ success: true, granted: true }),
  askIM: async () => ({ success: true, status: "authorized" }),
  requestAccessibilityPermission: async () => ({ success: true }),
  openSystemPreferences: () => undefined,
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
  | "hands-free-test"
  | "edit-test"
  | "meta-directives"
  | "cancel-info"
  | "settings-info"
  | "complete";

type AccountSummary = {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
};

const deriveAccountSummary = (
  profile: Awaited<ReturnType<typeof getProfile>>,
  user: Awaited<ReturnType<typeof getCurrentUser>>,
): AccountSummary | null => {
  if (!user) return null;
  const metadata = (user.user_metadata ?? {}) as {
    name?: string;
    avatar_url?: string;
  };
  const email = profile?.email ?? user.email ?? null;
  const displayName =
    profile?.display_name ??
    metadata.name ??
    (email ? email.split("@")[0] : null) ??
    "Sonic Flow user";

  return {
    id: profile?.id ?? user.id,
    displayName,
    email,
    avatarUrl: profile?.avatar_url ?? metadata.avatar_url ?? null,
  };
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
  const introOnly = params.has("introOnly") || import.meta.env?.VITE_INTRO_ONLY === "1";
  const [showIntro, setShowIntro] = useState<boolean>(true);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("auth");
  const [introControlsReady, setIntroControlsReady] = useState<boolean>(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authEmailRequested, setAuthEmailRequested] = useState(false);
  void authEmailRequested; // Magic link flow preserved but hidden from UI
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signedInAccount, setSignedInAccount] = useState<AccountSummary | null>(null);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [sessionValid, setSessionValid] = useState(false);
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
  const [optKeyPressed, setOptKeyPressed] = useState(false);
  const [cmdKeyPressed, setCmdKeyPressed] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const [testText, setTestText] = useState("");
  const [testTextTap, setTestTextTap] = useState("");
  // Track mount state and timeout handles to prevent leaks
  const isMountedRef = useRef(true);
  const switchAccountIntentRef = useRef(false);
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

  // Background music during onboarding
  const onboardingAudioRef = useRef<HTMLAudioElement | null>(null);
  const [musicEnabled, setMusicEnabled] = useState<boolean>(true);
  const targetMusicVolumeRef = useRef<number>(0.28);
  const fadeRafRef = useRef<number | null>(null);

  // Record onboarding visibility for auth intent correlation
  useEffect(() => {
    try { markOnboardingEvent(); } catch {}
    return () => {
      try { markOnboardingEvent(); } catch {}
    };
  }, []);

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
  const handleIntroFinish = () => {
    setShowIntro(false);
  };

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
        <button className="sf-intro-cta" onClick={() => setShowIntro(true)}>Replay intro</button>
      </div>
    );
  };
  // Sample prompts for tests
  const sampleEditText =
    "I wanna show you how Sonic Flow actually helps, how Sonic Flow actually behaves and why Sonic Flow is better than the other apps.";

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
        try { audio.pause(); } catch {}
      })();
    }
  };

  const refreshAccountSummary = async () => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        if (isMountedRef.current) setSignedInAccount(null);
        return null;
      }
      const profile = await getProfile();
      const account = deriveAccountSummary(profile, user);
      if (isMountedRef.current) setSignedInAccount(account);
      return account;
    } catch (error) {
      if (isMountedRef.current) setSignedInAccount(null);
      return null;
    }
  };

  useEffect(() => {
    if (!signedInAccount) {
      setAuthLoading(false);
      setIsSwitchingAccount(false);
      setSessionValid(false);
      switchAccountIntentRef.current = false;
      return;
    }
    switchAccountIntentRef.current = false;
    setSessionValid(true);
    setAuthLoading(false);
    setAuthError(null);
    setAuthEmail(signedInAccount.email ?? "");
    setAuthEmailRequested(false);
    setIsSwitchingAccount(false);
  }, [signedInAccount]);

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
              transition={{ duration: drawForward ? 0.24 : 0.2, ease: "easeOut" }}
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
  const getSteps = (): OnboardingStep[] => [
    "auth",
    "permissions",
    "mic-check",
    "hotkey-info",
    "hotkey-test",
    "hands-free-test",
    "edit-test",
    "cancel-info",
    "meta-directives",
    "settings-info",
    "complete",
  ];

  // Permission aggregates
  const allPermissionsGranted =
    permissions.microphone &&
    permissions.accessibility &&
    permissions.inputMonitoring;

  // Initial auth check and deep-link listener
  useEffect(() => {
    if (introOnly) return; // In intro-only mode, don't drive step state or auth
    getSupabase();
    (async () => {
      const skipAuth = !!window.devFlags?.skipAuth;
      const forceOnboarding = !!window.devFlags?.forceOnboarding;
      const user = await getCurrentUser();

      if (forceOnboarding) {
        await refreshAccountSummary();
        setCurrentStep("permissions");
        return;
      }

      if (!user && !skipAuth) {
        if (isMountedRef.current) setSignedInAccount(null);
        return; // stay on auth step until the user signs in
      }

      try {
        // Ensure a profile row exists for returning users (or first login on this device)
        try {
          await ensureProfileRow();
        } catch {}
        const profile = await getProfile();
        const account = deriveAccountSummary(profile, user);
        if (isMountedRef.current) setSignedInAccount(account);
        if (profile?.onboarding_done) {
          try {
            await window.electron?.setPttTarget?.("main");
          } catch (e) {
            console.warn("[Onboarding] setPttTarget failed:", e);
          }
          // (Removed) auth:set-signed-in — Supabase session is the source of truth
          await window.electron?.onboardingComplete();
          try { window.notifications?.send?.("You've been signed in."); } catch {}
          return;
        }
      } catch (error) {
        if (isMountedRef.current) setSignedInAccount(null);
      }

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
        switchAccountIntentRef.current = false;
        return;
      }
      const forceOnboarding = !!window.devFlags?.forceOnboarding;
      try {
        // Ensure a profile row exists as soon as login completes
        try {
          await ensureProfileRow();
        } catch {}
        const profile = await getProfile();
        const currentUser = await getCurrentUser();
        if (isMountedRef.current)
          setSignedInAccount(deriveAccountSummary(profile, currentUser));
        if (!forceOnboarding && profile?.onboarding_done) {
          try {
            await window.electron?.setPttTarget?.("main");
          } catch (e) {
            console.warn("[Onboarding] setPttTarget failed:", e);
          }
          // (Removed) auth:set-signed-in — Supabase session is the source of truth
          await window.electron?.onboardingComplete();
          // Show a consistent post sign-in toast once the pill/main window is up
          try { window.notifications?.send?.("You've been signed in."); } catch {}
          switchAccountIntentRef.current = false;
          return;
        }
      } catch {}
      if (switchAccountIntentRef.current && !forceOnboarding) {
        switchAccountIntentRef.current = false;
        return;
      }
      switchAccountIntentRef.current = false;
      setCurrentStep("permissions");
    });
    return () => {
      off && off();
    };
  }, [introOnly]);

  const startGoogleOAuth = async () => {
    try {
      setAuthLoading(true);
      setAuthError(null);
      const url = await getGoogleOAuthUrl();
      if (!url) {
        setAuthError(
          "Authentication setup failed. Please ensure Sonic Flow is properly configured and try again.",
        );
        setAuthLoading(false);
        return false;
      }
      await window.electron?.openExternal(url);
      setAuthLoading(false);
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setAuthError(msg || "Could not start Google sign-in");
      setAuthLoading(false);
      return false;
    }
  };

  const handleGoogle = async () => {
    await startGoogleOAuth();
  };

  const handleEmailStart = async () => {
    setAuthLoading(true);
    setAuthError(null);
    const res = await startEmailOtp(authEmail.trim());
    setAuthLoading(false);
    if (!res.ok) {
      setAuthError(res.error || "Failed to send Magic Link");
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
  void handleEmailSubmit;

  const handleSwitchAccount = async () => {
    if (authLoading || isSwitchingAccount) return;
    switchAccountIntentRef.current = true;
    setIsSwitchingAccount(true);
    setAuthError(null);
    setAuthLoading(true);
    try {
      await signOut();
    } catch (error) {
      if (isMountedRef.current) {
        const msg = error instanceof Error ? error.message : String(error);
        setAuthError(msg || "Could not switch account");
      }
    }
    if (isMountedRef.current) {
      setSessionValid(false);
    }
    const started = await startGoogleOAuth();
    if (isMountedRef.current) {
      if (!started) {
        setIsSwitchingAccount(false);
        setAuthLoading(false);
        switchAccountIntentRef.current = false;
      } else {
        setIsSwitchingAccount(false);
      }
    }
  };

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
      if (currentStep === "hotkey-info" || currentStep === "hotkey-test" || currentStep === "hands-free-test") {
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
      if (currentStep === "hotkey-info" || currentStep === "hotkey-test" || currentStep === "hands-free-test") {
        setOptKeyPressed(false);
      }
      setCurrentStep(steps[currentIndex - 1]);
    }
  };

  // Prepare the pill (create main window + tray) when entering test steps
  const pillPreparedRef = useRef(false);
  useEffect(() => {
    if ((currentStep === "hotkey-test" || currentStep === "hands-free-test" || currentStep === "edit-test") && !pillPreparedRef.current) {
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
    if (currentStep === "hotkey-test" || currentStep === "hands-free-test" || currentStep === "edit-test") {
      window.electron?.setPttTarget?.("main");
      // Reveal pill safely for test step (compact; main guarded against expansion)
      try { (window.electron as any)?.revealPillForTest?.(); } catch {}
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
            ? {
                deviceId: { exact: selectedMicId },
                ...AUDIO_PROCESSING_TRACK_CONSTRAINTS,
              }
            : { ...AUDIO_PROCESSING_TRACK_CONSTRAINTS },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStreamRef.current = stream;
      // Prefer a typed fallback for WebKit without using non-null assertions
      const Ctor = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio API not supported");
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
    if (
      currentStep !== "hotkey-test" &&
      currentStep !== "hands-free-test" &&
      currentStep !== "edit-test"
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
      try {
        await markOnboardingDone();
      } catch {}
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

  const authViewVariants: Variants = {
    hidden: { opacity: 0, y: 18, filter: "blur(12px)" },
    visible: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: {
        duration: devFlags.fastAnimations ? 0.22 : 0.36,
        ease: AUTH_EASE_VISIBLE,
      },
    },
    exit: {
      opacity: 0,
      y: -12,
      filter: "blur(8px)",
      transition: {
        duration: devFlags.fastAnimations ? 0.18 : 0.3,
        ease: AUTH_EASE_EXIT,
      },
    },
  };

  const showNavControls =
    !showIntro &&
    currentStep !== "complete" &&
    (currentStep !== "auth" || Boolean(signedInAccount));

  // --- Dictation test wiring for test steps ---
  useEffect(() => {
    if (currentStep === "hotkey-test" || currentStep === "hands-free-test") {
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
          aria-label={musicEnabled ? "Mute onboarding music" : "Unmute onboarding music"}
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
      <ParticlesCanvas />

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
      {(showIntro || currentStep === "auth" || currentStep === "permissions") && (
        <AnimatePresence initial={false}>
          {(showIntro ? introControlsReady : true) && (
            <motion.button
              key={showIntro ? "intro-toggle" : "onboarding-toggle"}
              className="pill-collapse-btn sf-intro-controls absolute top-4 right-4 no-drag"
              onClick={toggleMusic}
              aria-label={musicEnabled ? "Mute onboarding music" : "Unmute onboarding music"}
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
                    {signedInAccount ? "You're Signed In" : "Let's Get You Signed In"}
                  </h1>
                  <p className="text-sm text-subtle leading-relaxed subheading">
                    {signedInAccount
                      ? "You can switch to a different account anytime."
                      : "Choose your sign-in method"}
                  </p>
                </div>
                <AnimatePresence mode="wait">
                  {signedInAccount ? (
                    <motion.div
                      key="auth-summary"
                      variants={authViewVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="onboarding-section mx-auto w-full max-w-[19rem] space-y-3 text-left"
                    >
                      <div
                        className={`onboarding-permission-row flex items-center justify-between gap-3 p-3 ${
                          sessionValid ? "opacity-100" : "opacity-60"
                        }`}
                        aria-live="polite"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar
                            src={signedInAccount.avatarUrl ?? undefined}
                            fallbackLabel={signedInAccount.displayName}
                            alt={`Profile image for ${signedInAccount.displayName}`}
                            size="sm"
                            shape="rounded"
                            className="card-floating border border-white/10 rounded-[var(--radius-md)]"
                          />
                          <div className="min-w-0 space-y-[2px]">
                            <p className="text-sm font-semibold text-white truncate">
                              {signedInAccount.displayName}
                            </p>
                            {signedInAccount.email && (
                              <p className="text-xs text-subtle truncate">
                                {signedInAccount.email}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-white/70">
                          <SfIcon name="checkmark.seal.fill" size={22} />
                        </div>
                      </div>
                      <div className="w-full">
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={handleSwitchAccount}
                          disabled={authLoading}
                          className="w-full justify-center px-3 py-1.5"
                        >
                          {authLoading ? "Opening Google…" : "Switch Account"}
                        </Button>
                      </div>
                      {authError && (
                        <div className="text-[12px] text-red-300">{authError}</div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="auth-form"
                      variants={authViewVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="onboarding-section mx-auto w-full max-w-[19rem] space-y-4 text-left"
                    >
                      <Button
                        className="w-full onboarding-cta"
                        disabled={authLoading}
                        onClick={handleGoogle}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-primary font-medium text-lg">G</span>
                          <span>Continue with Google</span>
                        </div>
                      </Button>
                      {authError && (
                        <div className="text-[12px] text-red-300">{authError}</div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
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
                      <span className="keycap-legend-bottom font-system">option</span>
                    </div>
                    <p className="onboarding-note">Hold for push-to-talk, double tap for hands-free mode.</p>
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
                    Sonic Flow needs these permissions to work.
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
                            Microphone
                          </p>
                          <p className="onboarding-hint text-subtle">
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
                          <p className="onboarding-hint text-subtle">
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
                            size={20}
                            className="text-primary/70"
                          />
                        </div>
                        <div className="text-left">
                          <p className="text-[13px] font-medium text-foreground">
                            Input Monitoring
                          </p>
                          <p className="onboarding-hint text-subtle">Detect the Hotkey for dictation..</p>
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
                className="text-center"
              >
                <div className="heading-stack">
                  <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
                    Let’s Check Your Microphone
                  </h2>
                  <p className="text-sm text-subtle leading-relaxed subheading">
                    Pick the right input and say a few words. The bars should bounce.
                  </p>
                </div>

                <div className="onboarding-section space-y-5">
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
                    <div className="onboarding-hint onboarding-hint-before text-left text-dimmed">
                      Try saying: "Let's go! I'm so excited to use Sonic Flow! Write all of that in caps."
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
                      Double tap the hotkey to start dictation. Tap again to stop.
                    </p>
                  </div>
                  <div className="onboarding-section">
                    {/* Sample hint as tertiary text for improved hierarchy */}
                    <div className="onboarding-hint onboarding-hint-before text-left text-dimmed">
                      Try saying: "Look mom, no hands! Tag mom with an at symbol. And show excitement."
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
                      Select the text, hold the hotkey and give it instructions.
                    </p>
                  </div>
                  <div className="onboarding-section">
                    {/* Sample hint as tertiary text for improved hierarchy */}
                    <div className="onboarding-hint onboarding-hint-before text-left text-dimmed ml-2">
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
                      <span className="keycap-legend-bottom font-system">command</span>
                    </div>
                    <p className="onboarding-note">You can tap this key any time to cancel dictation.</p>
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
                <div className="flex flex-col items-center justify-center">
                  {/* Screen outline container */}
                  <div className="relative w-[320px] h-[200px] rounded-lg border-2 border-white/10 flex items-start justify-center pt-1">
                    {/* Pill container - positioned at top like real macOS island */}
                    <div className="relative">
                      {/* First ripple */}
                      <TapRipple delay={0} top="calc(50% - 11px)" left="calc(50% - 11px)" />
                      {/* Second ripple */}
                      <TapRipple delay={0.2} top="calc(50% - 11px)" left="calc(50% - 11px)" />
                      {/* Close tap ripple */}
                      <TapRipple delay={1.26} top="calc(100% - 19px)" left="calc(50% - 11px)" />
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
                          borderRadius: ["1.5px", "1.5px", "4px", "4px", "1.5px"],
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
                <p className="text-sm text-subtle leading-relaxed">It's been a pleasure onboarding you. You can now start dictating.</p>
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
          )}
        </div>

        {/* Navigation Controls */}
        {showNavControls && (
          <div className="absolute bottom-6 left-6 right-6 flex justify-between">
            {currentStep !== "auth" && (
              <Button
                variant="secondary"
                onClick={prevStep}
                disabled={getProgressStepIndex() <= 0}
                className="px-3 py-1.5"
              >
                Back
              </Button>
            )}

            {currentStep === "auth" && (
              <div className="flex-1" />
            )}

            {/* Next button appears consistently; permissions step still gated */}
            {currentStep !== "hotkey-test" && currentStep !== "hands-free-test" ? (
              <Button
                variant="secondary"
                onClick={() => {
                  nextStep();
                }}
                disabled={
                  (currentStep === "permissions" && !allPermissionsGranted) ||
                  (currentStep === "auth" && (!signedInAccount || !sessionValid || authLoading || isSwitchingAccount))
                }
                className="px-3 py-1.5"
              >
                Next
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  if (currentStep === "hotkey-test") {
                    setCurrentStep("hands-free-test");
                  } else if (currentStep === "hands-free-test") {
                    setCurrentStep("edit-test");
                  }
                }}
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
