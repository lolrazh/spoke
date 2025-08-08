import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";
// Temporarily inline the development flags for debugging
const devFlags = {
  mockPermissionStates: true,
  showDebugOverlay: true,
  fastAnimations: true,
  alwaysShowDevMode: true,
  isDevelopment: process.env.NODE_ENV === 'development',
  methods: {
    devLog: (...args: any[]) => console.log('[DEV]', ...args),
    devNotify: (message: string) => console.log('[DEV NOTIFY]', message),
  }
};

// Simple mock for now - starting in disabled state for UI development
const mockPermissions = {
  checkPermissions: async () => ({ needAX: true, needIM: true, isDev: true }),
  checkMicrophonePermission: async () => ({ status: 'denied', granted: false }),
  requestMicrophonePermission: async () => ({ success: true, granted: true }),
  askIM: async () => ({ success: true, status: 'authorized' }),
  requestAccessibilityPermission: async () => ({ success: true }),
  openSystemPreferences: async (pane: string) => ({ success: true }),
  resetPermissions: () => {}
};

type OnboardingStep = "welcome" | "permissions" | "hotkey-test" | "complete";

const Onboarding: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const [permissions, setPermissions] = useState({
    microphone: false,
    inputMonitoring: false,
    accessibility: false,
  });
  const [checking, setChecking] = useState(false);
  const [errors, setErrors] = useState({
    microphone: false,
    inputMonitoring: false,
    accessibility: false,
  });
  const [isDev, setIsDev] = useState(false);

  // Debug logging
  useEffect(() => {
    console.log("[Onboarding] Component mounted");
    console.log("[Onboarding] Current step:", currentStep);
    console.log("[Onboarding] Window location:", window.location.href);
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
      console.error("Error checking permissions:", error);
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
          console.log('[Onboarding] DOM ready, ensuring vibrancy visibility');
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

  // Helper to get the current steps array
  const getSteps = (): OnboardingStep[] => ["welcome", "permissions", "hotkey-test", "complete"];

  // Check if all permissions are granted
  const allPermissionsGranted = permissions.microphone && permissions.accessibility && permissions.inputMonitoring;

  // Auto-advance from permissions step when all are granted
  useEffect(() => {
    if (currentStep === "permissions" && allPermissionsGranted) {
      setTimeout(() => {
        setCurrentStep("hotkey-test");
      }, 1000); // Small delay to show success state
    }
  }, [currentStep, allPermissionsGranted]);

  // Navigation functions
  const nextStep = () => {
    const steps = getSteps();
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const prevStep = () => {
    const steps = getSteps();
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
    }
  };

  // Permission handlers - now work within combined interface
  const handleRequestMicrophone = async () => {
    setChecking(true);
    try {
      devFlags.methods.devLog('Requesting microphone permission...');
      
      const result = devFlags.mockPermissionStates 
        ? await mockPermissions.requestMicrophonePermission()
        : await window.electron?.requestMicrophonePermission();
      
      if (result?.success && result?.granted) {
        setPermissions(prev => ({ ...prev, microphone: true }));
        setErrors(prev => ({ ...prev, microphone: false }));
        devFlags.methods.devLog('Microphone permission granted');
      } else {
        // Permission denied or failed
        setErrors(prev => ({ ...prev, microphone: true }));
        devFlags.methods.devLog("Microphone permission denied or failed");
      }
    } catch (error) {
      console.error("Error requesting microphone permission:", error);
      setErrors(prev => ({ ...prev, microphone: true }));
    }
    setChecking(false);
  };

  const handleRequestInputMonitoring = async () => {
    devFlags.methods.devLog('Starting Input Monitoring permission request...');
    setChecking(true);
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
        } else if (result.status === "denied") {
          devFlags.methods.devLog('Input Monitoring permission denied - user needs to enable in Settings');
          setErrors(prev => ({ ...prev, inputMonitoring: false }));
          // Open System Preferences (mock or real)
          if (devFlags.mockPermissionStates) {
            await mockPermissions.openSystemPreferences("inputMonitoring");
          } else {
            window.electron?.openSystemPreferences("input-monitoring");
          }
        }
      } else {
        devFlags.methods.devLog('Input Monitoring permission request failed:', (result as any)?.error);
        setErrors(prev => ({ ...prev, inputMonitoring: true }));
      }
    } catch (error) {
      console.error("Error requesting input monitoring permission:", error);
      setErrors(prev => ({ ...prev, inputMonitoring: true }));
    }
    setChecking(false);
  };





  const handleRequestAccessibility = async () => {
    setChecking(true);
    try {
      devFlags.methods.devLog('Requesting accessibility permission...');
      
      if (devFlags.mockPermissionStates) {
        const result = await mockPermissions.requestAccessibilityPermission();
        if (result && 'success' in result && result.success) {
          setPermissions(prev => ({ ...prev, accessibility: true }));
          setErrors(prev => ({ ...prev, accessibility: false }));
        }
        setChecking(false);
        return;
      }
      
      await window.electron?.requestAccessibilityPermission();
      // Poll for permission changes
      const pollInterval = setInterval(async () => {
        const result = await window.electron?.checkPermissions();
        if (result && !result.needAX) {
          setPermissions(prev => ({ ...prev, accessibility: true }));
          setErrors(prev => ({ ...prev, accessibility: false }));
          setChecking(false);
          clearInterval(pollInterval);
        }
      }, 1000);
      
      // Stop polling after 10 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        setChecking(false);
      }, 10000);
    } catch (error) {
      console.error("Error requesting accessibility permission:", error);
      setErrors(prev => ({ ...prev, accessibility: true }));
      setChecking(false);
    }
  };



  const handleComplete = async () => {
    try {
      await window.electron?.startHelper();
      window.electron?.onboardingComplete();
    } catch (error) {
      console.error("Error completing onboarding:", error);
    }
  };

  // Step progress indicator
  // Returns the index (in the progress steps) of the current step, or -1 if not in progress steps
  const getProgressStepIndex = () => {
    const steps = getSteps();
    // Progress steps exclude 'welcome' and 'complete'
    const progressSteps = steps.slice(1, -1);
    return progressSteps.indexOf(currentStep);
  };

  // Animation variants (with dev speed control)
  const animationDuration = devFlags.fastAnimations ? 0.1 : 0.3;
  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { duration: animationDuration }
    },
    exit: { 
      opacity: 0, 
      y: -20,
      transition: { duration: animationDuration }
    }
  };


  return (
    <div className="flex flex-col h-full min-h-screen text-foreground onboarding-window relative">
      {/* Native macOS traffic lights are now handled by Electron with titleBarStyle: 'hiddenInset' */}
      
      {/* Draggable Header Areas */}
      <div className="onboarding-header" />
      
      {/* Development Mode Indicator & Controls */}
      {(isDev || devFlags.alwaysShowDevMode) && (
        <div className="absolute top-4 right-4 z-50 space-y-2">
          <div className="card-floating rounded-lg px-3 py-1">
            <span className="text-xs font-medium text-orange-300">
              Development Mode
              {devFlags.mockPermissionStates && " (Mock)"}
            </span>
          </div>
          
          {devFlags.showDebugOverlay && (
            <div className="card-floating rounded-lg p-2 text-xs space-y-1">
              <div className="text-orange-300 font-medium">Debug Panel</div>
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
                  className="text-blue-300 hover:text-blue-200 underline"
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
      
      {/* Main Content - Single Column */}
      <div className="flex-1 flex flex-col justify-center p-6 pt-10 relative min-h-0 overflow-hidden">
        <div className="max-w-2xl w-full mx-auto flex-1 flex flex-col justify-center max-h-full overflow-y-auto">
          
          {/* Progress indicator */}
          {currentStep !== "welcome" && currentStep !== "complete" && (
            <motion.div 
              className="flex items-center justify-center space-x-2 mb-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {getSteps().slice(1, -1).map((step, i) => (
                <div
                  key={step}
                  className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                    i < getProgressStepIndex()
                      ? "bg-primary"
                      : i === getProgressStepIndex()
                      ? "bg-muted-foreground"
                      : "bg-muted"
                  }`}
                />
              ))}
            </motion.div>
          )}

          <AnimatePresence mode="wait">
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
                <div className="space-y-3">
                  <h1 className="text-heading-xl heading-gradient">Welcome to Sonic Flow</h1>
                  <p className="text-sm text-subtle leading-relaxed">
                    Let's set up the permissions you need for voice dictation.
                  </p>
                </div>
                
                <div className="card-primary rounded-lg p-4 space-y-3">
                  <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Required Permissions</h2>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-3">
                      <svg className="w-3 h-3 text-primary/70" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                      </svg>
                      <span className="text-xs text-subtle">Microphone access to hear your voice</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <svg className="w-3 h-3 text-primary/70" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                      </svg>
                      <span className="text-xs text-subtle">Fn key monitoring for activation</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <svg className="w-3 h-3 text-primary/70" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                      </svg>
                      <span className="text-xs text-subtle">Text insertion for dictation</span>
                    </div>
                  </div>
                </div>
                
                <Button onClick={nextStep} className="w-full">
                  Continue
                </Button>
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
                <div className="space-y-3">
                  <h2 className="text-heading-lg heading-gradient">Grant Permissions</h2>
                  <p className="text-sm text-subtle leading-relaxed">
                    We need three permissions for Sonic Flow to work properly.
                  </p>
                </div>

                <div className="space-y-3">
                  {/* Microphone Permission */}
                  <div className="card-primary rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <svg className="w-4 h-4 text-primary/70" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-foreground">Microphone</p>
                          <p className="text-xs text-subtle">Record your voice for dictation</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {permissions.microphone ? (
                          <div className="flex items-center space-x-2 text-green-400">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-xs">Granted</span>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            onClick={handleRequestMicrophone}
                            disabled={checking}
                            className="text-xs"
                          >
                            {checking ? "..." : "Grant"}
                          </Button>
                        )}
                      </div>
                    </div>
                    {errors.microphone && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-xs text-red-400 mb-2">Permission denied. Enable manually:</p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => window.electron?.openSystemPreferences("microphone")}
                          className="text-xs"
                        >
                          Open System Preferences
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Input Monitoring Permission */}
                  <div className="card-primary rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <svg className="w-4 h-4 text-primary/70" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-foreground">Input Monitoring</p>
                          <p className="text-xs text-subtle">Detect Fn key presses</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {permissions.inputMonitoring ? (
                          <div className="flex items-center space-x-2 text-green-400">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-xs">Granted</span>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            onClick={handleRequestInputMonitoring}
                            disabled={checking}
                            className="text-xs"
                          >
                            {checking ? "..." : "Grant"}
                          </Button>
                        )}
                      </div>
                    </div>
                    {isDev && !permissions.inputMonitoring && (
                      <div className="mt-3 p-2 bg-orange-500/10 border border-orange-500/30 rounded text-xs text-orange-300">
                        <strong>Dev Mode:</strong> Look for "Electron" or "Cursor" in System Preferences
                      </div>
                    )}
                    {errors.inputMonitoring && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-xs text-red-400 mb-2">Enable in System Preferences:</p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => window.electron?.openSystemPreferences("input-monitoring")}
                          className="text-xs"
                        >
                          Open System Preferences
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Accessibility Permission */}
                  <div className="card-primary rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <svg className="w-4 h-4 text-primary/70" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-foreground">Accessibility</p>
                          <p className="text-xs text-subtle">Insert text into applications</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {permissions.accessibility ? (
                          <div className="flex items-center space-x-2 text-green-400">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-xs">Granted</span>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            onClick={handleRequestAccessibility}
                            disabled={checking}
                            className="text-xs"
                          >
                            {checking ? "..." : "Grant"}
                          </Button>
                        )}
                      </div>
                    </div>
                    {errors.accessibility && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-xs text-red-400 mb-2">Permission denied. Enable manually:</p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => window.electron?.openSystemPreferences("accessibility")}
                          className="text-xs"
                        >
                          Open System Preferences
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {allPermissionsGranted && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="card-elevated rounded-lg p-4 border border-green-500/20"
                  >
                    <div className="flex items-center justify-center space-x-2 text-green-400">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm font-medium">All permissions granted!</p>
                    </div>
                    <p className="text-xs text-subtle mt-2">Proceeding to setup test...</p>
                  </motion.div>
                )}
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
                <div className="space-y-2">
                  <h2 className="text-heading-lg heading-gradient">Test Your Setup</h2>
                  <p className="text-sm text-subtle">
                    Let's make sure everything works properly.
                  </p>
                </div>

                <div className="flex items-center justify-center space-x-6">
                  {/* Compact Fn Key Display */}
                  <div className="text-center">
                    <div className="w-12 h-8 rounded bg-secondary border border-border flex items-center justify-center mb-2">
                      <span className="text-sm font-mono font-bold">Fn</span>
                    </div>
                    <p className="text-xs font-medium text-foreground">Activation Key</p>
                  </div>
                  
                  {/* Compact Instructions */}
                  <div className="text-left flex-1 max-w-sm">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Quick Test</p>
                    <div className="space-y-1 text-xs text-dimmed">
                      <div>1. Open Notes or any text app</div>
                      <div>2. Hold <strong>Fn</strong> and say "Hello world"</div>
                      <div>3. Release <strong>Fn</strong> and see the magic! ✨</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <Button 
                    onClick={handleComplete}
                    className="w-full"
                  >
                    Start Sonic Flow
                  </Button>
                  
                  <Button 
                    variant="secondary"
                    onClick={() => setCurrentStep("permissions")}
                    className="w-full text-xs"
                  >
                    ← Back to Permissions
                  </Button>
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
                <div className="text-primary text-4xl mb-4">✓</div>
                <h2 className="text-heading-lg heading-gradient">All Set!</h2>
                <p className="text-sm text-subtle leading-relaxed">
                  Sonic Flow is ready to use. Enjoy your voice dictation!
                </p>
              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* Navigation Controls */}
        {currentStep !== "welcome" && currentStep !== "complete" && (
          <div className="absolute bottom-6 left-6 right-6 flex justify-between">
            <Button 
              variant="secondary" 
              onClick={prevStep}
              disabled={getProgressStepIndex() <= 0}
              className="px-4 py-2"
            >
              Back
            </Button>
            
            <Button 
              variant="secondary" 
              onClick={() => {
                // Skip to the end
                setCurrentStep("hotkey-test");
              }}
              className="px-4 py-2"
            >
              Skip Setup
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;