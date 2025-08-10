import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";
import { useTranscription } from "../hooks/useTranscription";
// Development flags - only enabled in development mode
const isDevelopment = process.env.NODE_ENV === 'development';
// Make permission mocking opt-in via URL (?mockPerms)
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const devFlags = {
  mockPermissionStates: isDevelopment && params.has('mockPerms'),
  showDebugOverlay: isDevelopment,
  fastAnimations: isDevelopment,
  alwaysShowDevMode: isDevelopment,
  isDevelopment,
  methods: {
    devLog: (...args: unknown[]) => {
      if (isDevelopment) console.log('[DEV]', ...args);
    },
    devNotify: (message: string) => {
      if (isDevelopment) console.log('[DEV NOTIFY]', message);
    },
  }
};

// Simple mock for now - starting in disabled state for UI development
  const mockPermissions = {
  checkPermissions: async () => ({ needAX: true, needIM: true, isDev: true }),
  checkMicrophonePermission: async () => ({ status: 'denied', granted: false }),
  requestMicrophonePermission: async () => ({ success: true, granted: true }),
  askIM: async () => ({ success: true, status: 'authorized' }),
  requestAccessibilityPermission: async () => ({ success: true }),
    openSystemPreferences: async (_pane: string) => ({ success: true }),
  resetPermissions: () => { 
    if (isDevelopment) console.debug('[MockPermissions] resetPermissions'); 
  }
};

type OnboardingStep = "welcome" | "permissions" | "hotkey-info" | "hotkey-test" | "complete";

const Onboarding: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const [permissions, setPermissions] = useState({
    microphone: false,
    inputMonitoring: false,
    accessibility: false,
  });
  // UI state per-permission for loading + success animation
  const [ui, setUi] = useState({
    microphone: { loading: false, justGranted: false },
    inputMonitoring: { loading: false, justGranted: false },
    accessibility: { loading: false, justGranted: false },
  });
  const [errors, setErrors] = useState({
    microphone: false,
    inputMonitoring: false,
    accessibility: false,
  });
  const [isDev, setIsDev] = useState(false);
  const [pttApiReady, setPttApiReady] = useState(false);
  const [fnKeyPressed, setFnKeyPressed] = useState(false);
  // Poll timers for system permissions (cleared on unmount)
  const pollRefs = useRef<{ mic?: NodeJS.Timeout | null; im?: NodeJS.Timeout | null; ax?: NodeJS.Timeout | null }>({});
  // Track mount state and timeout handles to prevent leaks
  const isMountedRef = useRef(true);
  const pttCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent duplicate deep-links for Accessibility
  const axDeepLinkOpenedRef = useRef(false);

  // Debug logging and listen for explicit PTT readiness from helper
  useEffect(() => {
    devFlags.methods.devLog("Component mounted");
    devFlags.methods.devLog("Current step:", currentStep);
    devFlags.methods.devLog("Window location:", window.location.href);

    // Listen for explicit ready from main/helper
    const cleanupReady = window.ptt?.onReady?.(() => {
      devFlags.methods.devLog('Received ptt-ready');
      setPttApiReady(true);
    });

    return () => {
      cleanupReady && cleanupReady();
    };
  }, []);

  // Note: App location check moved to silent background check
  // No longer part of onboarding wizard flow

  // Function to check permissions (with mock support)
  const checkPermissions = async () => {
    try {
      devFlags.methods.devLog('Checking permissions...');
      
      const [systemPerms, micPerms] = await Promise.all([
        devFlags.mockPermissionStates ? mockPermissions.checkPermissions() : window.electron?.checkPermissions(),
        devFlags.mockPermissionStates ? mockPermissions.checkMicrophonePermission() : window.electron?.checkMicrophonePermission()
      ]);
      
      setIsDev(systemPerms?.isDev || devFlags.isDevelopment);
      setPermissions({
        microphone: micPerms?.granted || false,
        inputMonitoring: !systemPerms?.needIM,
        accessibility: !systemPerms?.needAX,
      });
      
      devFlags.methods.devLog('Permissions checked:', {
        microphone: micPerms?.granted || false,
        inputMonitoring: !systemPerms?.needIM,
        accessibility: !systemPerms?.needAX,
        mock: (systemPerms as any)?.mock || (micPerms as any)?.mock
      });
    } catch (error) {
      if (isDevelopment) console.error("Error checking permissions:", error);
    }
  };

  useEffect(() => {
    checkPermissions();
    
    // FIX 13: Ensure DOM is fully ready before showing content
    const handleDOMContentLoaded = () => {
      // Force a small delay to ensure vibrancy has settled
      setTimeout(() => {
        const onboardingWindow = document.querySelector('.onboarding-window') as HTMLElement;
        if (onboardingWindow) {
          devFlags.methods.devLog('DOM ready, ensuring vibrancy visibility');
          // Ensure the window becomes visible by triggering a minimal style change
          onboardingWindow.style.transform = 'translateZ(0)';
        }
      }, 50);
    };

    // FIX 14: Handle initial content load timing
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', handleDOMContentLoaded);
    } else {
      // DOM already loaded
      handleDOMContentLoaded();
    }
    
    // Fix resize color glitching by temporarily disabling backdrop-filter
    let resizeTimeout: NodeJS.Timeout | null = null;
    
    const handleResizeStart = () => {
      const onboardingWindow = document.querySelector('.onboarding-window') as HTMLElement;
      if (onboardingWindow) {
        onboardingWindow.classList.add('resizing');
      }
    };
    
    const handleResizeEnd = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const onboardingWindow = document.querySelector('.onboarding-window') as HTMLElement;
        if (onboardingWindow) {
          onboardingWindow.classList.remove('resizing');
        }
      }, 150);
    };
    
    // Listen for window resize events
    window.addEventListener('resize', handleResizeStart);
    window.addEventListener('resize', handleResizeEnd);
    
    return () => {
      document.removeEventListener('DOMContentLoaded', handleDOMContentLoaded);
      window.removeEventListener('resize', handleResizeStart);
      window.removeEventListener('resize', handleResizeEnd);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, []);

  // Helper function to clear all polling timers
  const clearAllPolling = () => {
    Object.values(pollRefs.current).forEach(timer => {
      if (timer) {
        clearInterval(timer);
      }
    });
    // Reset the refs to null
    pollRefs.current = { mic: null, im: null, ax: null };
  };

  // Clear any active polling timers on unmount
  useEffect(() => {
    return () => {
      clearAllPolling();
      setFnKeyPressed(false); // Reset Fn key state
      isMountedRef.current = false;
      if (pttCheckTimeoutRef.current) {
        clearTimeout(pttCheckTimeoutRef.current);
        pttCheckTimeoutRef.current = null;
      }
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
    };
  }, []);

  // Helper to get the current steps array
  const getSteps = (): OnboardingStep[] => ["welcome", "permissions", "hotkey-info", "hotkey-test", "complete"];

  // Permission aggregates
  const allPermissionsGranted = permissions.microphone && permissions.accessibility && permissions.inputMonitoring;

  // Start helper when entering the hotkey info step (after permissions) so Fn key testing works
  useEffect(() => {
    if (currentStep === "hotkey-info" && !pttApiReady) {
      // Ensure PTT events route to onboarding while testing
      window.electron?.setPttTarget?.("onboarding");
      const startHelperForTesting = async () => {
        try {
          devFlags.methods.devLog('Starting helper for onboarding testing...');
          await window.electron?.startHelper();
          // Helper will emit 'ready' -> handled by onReady listener above.
        } catch (error) {
          if (isDevelopment) console.error("Error starting helper for testing:", error);
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

  // Prepare the pill (create main window + tray) when entering the hotkey test step
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

  // Show the pill UI during the hotkey-test step; hide it on other steps
  useEffect(() => {
    if (currentStep === "hotkey-test") {
      // Route PTT to the main pill for dictation testing
      window.electron?.setPttTarget?.("main");
      // Show pill by sliding it into view
      window.island?.slideTo?.(-60);
    } else {
      // Hide pill by sliding it out of view
      window.island?.slideTo?.(-160);
    }
  }, [currentStep]);

  // Auto-focus the text box on step 4 for better UX
  useEffect(() => {
    if (currentStep !== "hotkey-test") return;
    const id = setTimeout(() => {
      textAreaRef.current?.focus();
    }, 50);
    return () => clearTimeout(id);
  }, [currentStep]);

  // Permission handlers - now work within combined interface
  const handleRequestMicrophone = async () => {
    try {
      devFlags.methods.devLog('Requesting microphone permission...');
      
      const result = devFlags.mockPermissionStates 
        ? await mockPermissions.requestMicrophonePermission()
        : await window.electron?.requestMicrophonePermission();
      
      if (result?.success && result?.granted) {
        setPermissions(prev => ({ ...prev, microphone: true }));
        setErrors(prev => ({ ...prev, microphone: false }));
        devFlags.methods.devLog('Microphone permission granted');
        // Trigger success animation in-place where the button was
        setUi((prev) => ({
          ...prev,
          microphone: { loading: false, justGranted: true },
        }));
        setTimeout(() => {
          if (!isMountedRef.current) return;
          setUi((prev) => ({
            ...prev,
            microphone: { ...prev.microphone, justGranted: false },
          }));
        }, 800);
      } else {
        // Open the correct System Settings pane and begin polling until granted
        devFlags.methods.devLog('Opening System Settings for microphone…');
        if (devFlags.mockPermissionStates) {
          await mockPermissions.openSystemPreferences('microphone');
        } else {
          window.electron?.openSystemPreferences('microphone');
        }
        // Clear any existing microphone polling before starting new one
        if (pollRefs.current.mic) {
          clearInterval(pollRefs.current.mic);
          pollRefs.current.mic = null;
        }
        pollRefs.current.mic = setInterval(async () => {
          const status = devFlags.mockPermissionStates
            ? await mockPermissions.checkMicrophonePermission()
            : await window.electron?.checkMicrophonePermission();
          if (status?.granted) {
            if (pollRefs.current.mic) {
              clearInterval(pollRefs.current.mic);
              pollRefs.current.mic = null;
            }
            setPermissions(prev => ({ ...prev, microphone: true }));
            setUi(prev => ({ ...prev, microphone: { loading: false, justGranted: true } }));
            setTimeout(() => {
              if (!isMountedRef.current) return;
              setUi(prev => ({ ...prev, microphone: { ...prev.microphone, justGranted: false } }));
            }, 800);
          }
        }, 1000);
      }
    } catch (error) {
      if (isDevelopment) console.error("Error requesting microphone permission:", error);
      setErrors(prev => ({ ...prev, microphone: true }));
    }
  };

  const handleRequestInputMonitoring = async () => {
    devFlags.methods.devLog('Starting Input Monitoring permission request...');
    try {
      // Use mock or real Input Monitoring request
      const result = devFlags.mockPermissionStates
        ? await mockPermissions.askIM()
        : await window.electron?.askIM();
      
      devFlags.methods.devLog('Input Monitoring permission request result:', result);
      
      if (result?.success) {
        if (result.status === "authorized") {
          devFlags.methods.devLog('Input Monitoring permission granted');
          setPermissions(prev => ({ ...prev, inputMonitoring: true }));
          setErrors(prev => ({ ...prev, inputMonitoring: false }));
          setUi((prev) => ({
            ...prev,
            inputMonitoring: { loading: false, justGranted: true },
          }));
          setTimeout(() => {
            if (!isMountedRef.current) return;
            setUi((prev) => ({
              ...prev,
              inputMonitoring: { ...prev.inputMonitoring, justGranted: false },
            }));
          }, 800);
        } else if (result.status === "denied") {
          devFlags.methods.devLog('Input Monitoring permission denied - opening System Settings');
          if (devFlags.mockPermissionStates) {
            await mockPermissions.openSystemPreferences("inputMonitoring");
          } else {
            window.electron?.openSystemPreferences("input-monitoring");
          }
          // Clear any existing input monitoring polling before starting new one
          if (pollRefs.current.im) {
            clearInterval(pollRefs.current.im);
            pollRefs.current.im = null;
          }
          pollRefs.current.im = setInterval(async () => {
            const sys = devFlags.mockPermissionStates
              ? await mockPermissions.checkPermissions()
              : await window.electron?.checkPermissions();
            if (sys && !sys.needIM) {
              if (pollRefs.current.im) {
                clearInterval(pollRefs.current.im);
                pollRefs.current.im = null;
              }
              setPermissions(prev => ({ ...prev, inputMonitoring: true }));
              setUi(prev => ({ ...prev, inputMonitoring: { loading: false, justGranted: true } }));
              setTimeout(() => {
                if (!isMountedRef.current) return;
                setUi(prev => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, justGranted: false } }));
              }, 800);
            }
          }, 1000);
        }
      } else {
        devFlags.methods.devLog('Input Monitoring permission request failed:', (result as any)?.error);
        // Open pane and poll anyway
        if (devFlags.mockPermissionStates) {
          await mockPermissions.openSystemPreferences("inputMonitoring");
        } else {
          window.electron?.openSystemPreferences("input-monitoring");
        }
        // Clear any existing input monitoring polling before starting new one
        if (pollRefs.current.im) {
          clearInterval(pollRefs.current.im);
          pollRefs.current.im = null;
        }
        pollRefs.current.im = setInterval(async () => {
          const sys = devFlags.mockPermissionStates
            ? await mockPermissions.checkPermissions()
            : await window.electron?.checkPermissions();
          if (sys && !sys.needIM) {
            if (pollRefs.current.im) {
              clearInterval(pollRefs.current.im);
              pollRefs.current.im = null;
            }
            setPermissions(prev => ({ ...prev, inputMonitoring: true }));
            setUi(prev => ({ ...prev, inputMonitoring: { loading: false, justGranted: true } }));
            setTimeout(() => {
              if (!isMountedRef.current) return;
              setUi(prev => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, justGranted: false } }));
            }, 800);
          }
        }, 1000);
      }
    } catch (error) {
      if (isDevelopment) console.error("Error requesting input monitoring permission:", error);
      setErrors(prev => ({ ...prev, inputMonitoring: true }));
    }
  };





  const handleRequestAccessibility = async () => {
    try {
      devFlags.methods.devLog('Requesting accessibility permission...');
      
      if (devFlags.mockPermissionStates) {
        const result = await mockPermissions.requestAccessibilityPermission();
        if (result && 'success' in result && result.success) {
          setPermissions(prev => ({ ...prev, accessibility: true }));
          setErrors(prev => ({ ...prev, accessibility: false }));
          setUi((prev) => ({
            ...prev,
            accessibility: { loading: false, justGranted: true },
          }));
          setTimeout(() => {
            if (!isMountedRef.current) return;
            setUi((prev) => ({
              ...prev,
              accessibility: { ...prev.accessibility, justGranted: false },
            }));
          }, 800);
        }
        return;
      }
      
      // Trigger OS prompt (may itself open System Settings upon user action)
      await window.electron?.requestAccessibilityPermission();
      // Do NOT immediately open System Settings to avoid duplicate prompts.
      // We will poll and only deep-link as a fallback if still denied after a grace period.
      axDeepLinkOpenedRef.current = false;
      // Clear any existing accessibility polling before starting new one
      if (pollRefs.current.ax) {
        clearInterval(pollRefs.current.ax);
        pollRefs.current.ax = null;
      }
      const startedAt = Date.now();
      pollRefs.current.ax = setInterval(async () => {
        const result = await window.electron?.checkPermissions();
        if (result && !result.needAX) {
          if (pollRefs.current.ax) {
            clearInterval(pollRefs.current.ax);
            pollRefs.current.ax = null;
          }
          setPermissions(prev => ({ ...prev, accessibility: true }));
          setErrors(prev => ({ ...prev, accessibility: false }));
          setUi((prev) => ({
            ...prev,
            accessibility: { loading: false, justGranted: true },
          }));
          setTimeout(() => {
            if (!isMountedRef.current) return;
            setUi((prev) => ({
              ...prev,
              accessibility: { ...prev.accessibility, justGranted: false },
            }));
          }, 800);
        } else {
          // After a short grace period, deep-link once as a fallback if permission still denied
          const elapsedMs = Date.now() - startedAt;
          if (!axDeepLinkOpenedRef.current && elapsedMs > 4000) {
            devFlags.methods.devLog('AX still denied after grace period; opening System Settings (once).');
            axDeepLinkOpenedRef.current = true;
            window.electron?.openSystemPreferences('accessibility');
          }
        }
      }, 1000);
    } catch (error) {
      if (isDevelopment) console.error("Error requesting accessibility permission:", error);
      setErrors(prev => ({ ...prev, accessibility: true }));
    }
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
    // Small delay for UX before closing
    setTimeout(() => {
      try { window.electron?.closeOnboarding?.(); } catch (e) { /* ignore */ }
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
  const trans = useTranscription({ autoEnumerateDevices: false, autoInitStream: false });
  const [testText, setTestText] = useState("");
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // Minimal debounce utility
  const debounce = <T extends (...args: unknown[]) => void>(func: T, delay: number) => {
    let timeoutId: NodeJS.Timeout | null = null;
    return (...args: Parameters<T>) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), delay);
    };
  };

  // Append recognized text to test area
  useEffect(() => {
    if (trans.text) {
      setTestText((prev) => (prev ? `${prev} ${trans.text}` : trans.text));
    }
  }, [trans.text]);

  // Hook Fn key to provide visual feedback on step 3; only dictate on step 4
  useEffect(() => {
    if (!window.ptt?.onDown || !window.ptt?.onUp) {
      devFlags.methods.devLog('PTT API not available yet, waiting...');
      return;
    }

    devFlags.methods.devLog('PTT API available, setting up Fn key handlers');
    const HOLD_MS = 180;
    const handleDown = () => {
      devFlags.methods.devLog('Fn key pressed down');
      setFnKeyPressed(true); // Immediate visual feedback
      
      // Only start dictation on hotkey-test step (step 4)
      if (currentStep !== "hotkey-test") return;
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (trans.processing || trans.recording) return;
      isLongPressRef.current = false;
      pressTimerRef.current = setTimeout(() => {
        isLongPressRef.current = true;
        if (!trans.recording) trans.start();
      }, HOLD_MS);
    };
    const handleUp = () => {
      devFlags.methods.devLog('Fn key released');
      setFnKeyPressed(false); // Immediate visual feedback
      
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
      // Only stop dictation on hotkey-test step (step 4)
      if (currentStep === "hotkey-test" && trans.recording) trans.stop();
      isLongPressRef.current = false;
    };

    const cleanupDown = window.ptt.onDown(debounce(handleDown, 50));
    const cleanupUp = window.ptt.onUp(debounce(handleUp, 50));
    return () => {
      cleanupDown?.();
      cleanupUp?.();
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
    };
  }, [trans.recording, trans.processing, pttApiReady, currentStep]); // Re-run when PTT API becomes ready


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
                const toneClass = isActive ? "bar-active" : isComplete ? "bar-complete" : "bar-upcoming";
                return (
                  <div key={step} className={`onboarding-progress-bar ${toneClass} ${growClass} ${heightClass}`} />
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
              <div className="text-xs text-dimmed">
                Step: {currentStep}
              </div>
              <div className="text-xs text-dimmed">
                Perms: M:{permissions.microphone ? '✓' : '✗'} 
                A:{permissions.accessibility ? '✓' : '✗'} 
                I:{permissions.inputMonitoring ? '✓' : '✗'}
              </div>
              {devFlags.mockPermissionStates && (
                <button 
                  className="text-white/70 hover:text-white/90 underline"
                  onClick={() => {
                    // Quick reset for development
                    setPermissions({ microphone: false, accessibility: false, inputMonitoring: false });
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
        {/* Hotkey Info Step */}
        {currentStep === "hotkey-info" && (
          <motion.div
            key="hotkey-info"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="text-center space-y-4"
          >
            <div className="heading-stack">
              <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">Your Hotkey is the Fn key</h2>
              <p className="text-sm text-subtle subheading">Press and hold to speak. Release to stop.</p>
            </div>
            <div className="flex flex-col items-center justify-center gap-2">
              <div 
                className={`keycap keycap-lg ${fnKeyPressed || trans.recording ? "keycap-active" : ""}`}
                aria-label={fnKeyPressed || trans.recording ? "Function key active - recording in progress" : "Function key - press and hold to start dictation"}
                aria-live="polite"
              >
                <span className="keycap-label text-[12px] font-system lowercase">fn</span>
              </div>
              <p className="text-[11px] text-dimmed">Press your Fn key now to test it.</p>
            </div>
            {/* Removed central Continue button; Next lives in bottom-right consistently */}
          </motion.div>
        )}
            {/* Welcome Step */}
            {currentStep === "welcome" && (
              <motion.div
                key="welcome"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-4"
              >
                <div className="heading-stack">
                  <h1 className="text-heading-xl heading-gradient heading-crisp text-breathe">Welcome to Sonic Flow</h1>
                  <p className="text-sm text-subtle leading-relaxed subheading">
                    Let's get you started.
                  </p>
                </div>
                <div className="flex justify-center">
                  <Button onClick={nextStep} className="px-5 py-2 onboarding-cta shimmer">
                    Start Setup
                  </Button>
                </div>
              </motion.div>
            )}



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
                  <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">Enable Required Permissions</h2>
                  <p className="text-sm text-subtle leading-relaxed subheading">Sonic Flow needs these macOS permissions to work.</p>
                </div>

                <div className="space-y-3">
                  {/* Microphone Permission */}
                  <div className={`onboarding-permission-row rounded-lg p-3 transition-opacity duration-300 ${permissions.microphone ? "opacity-60" : "opacity-100"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                          <svg className="w-4 h-4 text-primary/70" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-foreground">Microphone</p>
                           <p className="text-[11px] text-subtle">Capture your voice for dictation.</p>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <div className="relative w-[84px] flex items-center justify-center">
                          <AnimatePresence mode="wait" initial={false}>
                            {!permissions.microphone ? (
                              <motion.div
                                key={ui.microphone.loading ? "mic-loading" : "mic-idle"}
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
                                    initial={{ pathLength: ui.microphone.justGranted ? 0 : 1 }}
                                    animate={{ pathLength: 1 }}
                                    transition={ui.microphone.justGranted ? { duration: 0.45, ease: [0.25, 0.8, 0.25, 1] } : { duration: 0 }}
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
                  <div className={`onboarding-permission-row rounded-lg p-3 transition-opacity duration-300 ${permissions.accessibility ? "opacity-60" : "opacity-100"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                          <svg className="w-4 h-4 text-primary/70" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-foreground">Accessibility</p>
                           <p className="text-[11px] text-subtle">Insert recognized text into your apps.</p>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <div className="relative w-[84px] flex items-center justify-center">
                          <AnimatePresence mode="wait" initial={false}>
                            {!permissions.accessibility ? (
                              <motion.div
                                key={ui.accessibility.loading ? "ax-loading" : "ax-idle"}
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
                                    initial={{ pathLength: ui.accessibility.justGranted ? 0 : 1 }}
                                    animate={{ pathLength: 1 }}
                                    transition={ui.accessibility.justGranted ? { duration: 0.45, ease: [0.25, 0.8, 0.25, 1] } : { duration: 0 }}
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
                  <div className={`onboarding-permission-row rounded-lg p-3 transition-opacity duration-300 ${permissions.inputMonitoring ? "opacity-60" : "opacity-100"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center">
                          <svg className="w-4 h-4 text-primary/70" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-foreground">Input Monitoring</p>
                           <p className="text-[11px] text-subtle">Detect the Fn key to start and stop dictation.</p>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <div className="relative w-[84px] flex items-center justify-center">
                          <AnimatePresence mode="wait" initial={false}>
                            {!permissions.inputMonitoring ? (
                              <motion.div
                                key={ui.inputMonitoring.loading ? "im-loading" : "im-idle"}
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
                                    initial={{ pathLength: ui.inputMonitoring.justGranted ? 0 : 1 }}
                                    animate={{ pathLength: 1 }}
                                    transition={ui.inputMonitoring.justGranted ? { duration: 0.45, ease: [0.25, 0.8, 0.25, 1] } : { duration: 0 }}
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



            {/* Hotkey Test Step */}
            {currentStep === "hotkey-test" && (
              <motion.div
                key="hotkey-test"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-3 overflow-hidden"
              >
                <div className="space-y-3 max-w-xl mx-auto text-left">
                  <div className="text-center heading-stack">
                    <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">Test Your Setup</h2>
                    <p className="text-sm text-subtle subheading">Press and hold Fn to dictate, then release to stop.</p>
                  </div>

                  {/* Dictation Textarea */}
                  <div>
                    {/* removed the small label above the textarea */}
                    <textarea
                      className={"w-full h-28 resize-none onboarding-textarea px-4 py-4 text-sm outline-none overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 hover:scrollbar-thumb-white/30"}
                      placeholder="Say something…"
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      ref={textAreaRef}
                    />
                  </div>

                  {/* No CTA here; proceed with Next to the completion screen */}
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
                   <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-white/80">
                     <motion.path
                       initial={{ pathLength: 0 }}
                       animate={{ pathLength: 1 }}
                       transition={{ delay: 0.2, duration: 0.6, ease: [0.25, 0.8, 0.25, 1] }}
                       d="M5 13l4 4L19 7"
                       stroke="currentColor"
                       strokeWidth="2.25"
                       strokeLinecap="round"
                       strokeLinejoin="round"
                     />
                   </svg>
                 </motion.div>
                <h2 className="text-heading-xl heading-gradient heading-crisp text-breathe">You're all set</h2>
                <p className="text-sm text-subtle leading-relaxed">Your voice is now your keyboard. Press Fn to dictate anywhere.</p>
                <div className="pt-2 flex justify-center">
                  <Button onClick={handleComplete} className="px-5 py-2 onboarding-cta shimmer">
                    Start Dictating
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* Navigation Controls (hidden on welcome) */}
        {currentStep !== "complete" && currentStep !== "welcome" && (
          <div className="absolute bottom-6 left-6 right-6 flex justify-between">
            <Button
              variant="secondary"
              onClick={prevStep}
              disabled={getProgressStepIndex() <= 0}
              className="px-3 py-1.5"
            >
              Back
            </Button>

            {/* Next button appears on permissions and hotkey-info */}
            {currentStep !== "hotkey-test" && (
              <Button
                variant="secondary"
                onClick={() => {
                  nextStep();
                }}
                disabled={currentStep === "permissions" && !allPermissionsGranted}
                className="px-3 py-1.5"
              >
                Next
              </Button>
            )}
            {currentStep === "hotkey-test" && (
              <Button
                variant="secondary"
                onClick={() => setCurrentStep("complete")}
                className="px-3 py-1.5"
                disabled={!testText || testText.trim().length === 0}
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