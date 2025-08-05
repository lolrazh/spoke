import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";

type OnboardingStep = "welcome" | "location" | "microphone" | "accessibility" | "input-monitoring" | "test" | "complete";

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
  const [needsLocationFix, setNeedsLocationFix] = useState(false);

  // Debug logging
  useEffect(() => {
    console.log("[Onboarding] Component mounted");
    console.log("[Onboarding] Current step:", currentStep);
    console.log("[Onboarding] Window location:", window.location.href);
  }, []);

  // Check if app needs to be moved to Applications folder
  const checkAppLocation = async () => {
    try {
      const appPath = await window.electron?.getAppPath();
      if (appPath) {
        const needsMove = !appPath.startsWith('/Applications/') && (
          appPath.includes('/Documents/') ||
          appPath.includes('/Downloads/') ||
          appPath.includes('/Desktop/')
        );
        setNeedsLocationFix(needsMove);
        
        // If app needs to be moved, start with location step
        if (needsMove && currentStep === "welcome") {
          setCurrentStep("location");
        }
      }
    } catch (error) {
      console.error("Error checking app location:", error);
    }
  };

  // Function to check permissions
  const checkPermissions = async () => {
    try {
      const [systemPerms, micPerms] = await Promise.all([
        window.electron?.checkPermissions(),
        window.electron?.checkMicrophonePermission()
      ]);
      
      setIsDev(systemPerms?.isDev || false);
      setPermissions({
        microphone: micPerms?.granted || false,
        inputMonitoring: !systemPerms?.needIM,
        accessibility: !systemPerms?.needAX,
      });
    } catch (error) {
      console.error("Error checking permissions:", error);
    }
  };

  useEffect(() => {
    checkAppLocation();
    checkPermissions();
  }, []);

  // Helper to get the current steps array
  const getSteps = (): OnboardingStep[] =>
    needsLocationFix
      ? ["welcome", "location", "microphone", "accessibility", "input-monitoring", "test", "complete"]
      : ["welcome", "microphone", "accessibility", "input-monitoring", "test", "complete"];

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

  // Permission handlers
  const handleRequestMicrophone = async () => {
    setChecking(true);
    try {
      const result = await window.electron?.requestMicrophonePermission();
      
      if (result?.success && result?.granted) {
        setPermissions(prev => ({ ...prev, microphone: true }));
        setChecking(false);
        nextStep();
      } else {
        // Permission denied or failed
        setChecking(false);
        setErrors(prev => ({ ...prev, microphone: true }));
        console.log("Microphone permission denied or failed");
      }
    } catch (error) {
      console.error("Error requesting microphone permission:", error);
      setChecking(false);
    }
  };

    const handleRequestInputMonitoring = async () => {
    console.log('[Onboarding] Starting Input Monitoring permission request...');
    setChecking(true);
    try {
      // Use the new proper Input Monitoring request
      const result = await window.electron?.askIM();
      console.log('[Onboarding] Permission request result:', result);
      
      setChecking(false);
      
      if (result?.success) {
        if (result.status === "authorized") {
          console.log('[Onboarding] Permission granted - auto advancing');
          // Permission was granted - auto advance
          setPermissions(prev => ({ ...prev, inputMonitoring: true }));
          nextStep();
        } else if (result.status === "denied") {
          console.log('[Onboarding] Permission denied - user needs to enable in Settings');
          // Permission was denied - open System Preferences
          setErrors(prev => ({ ...prev, inputMonitoring: false })); // Clear any previous errors
          // Open System Preferences to Input Monitoring
          window.electron?.openSystemPreferences("input-monitoring");
        }
      } else {
        console.log('[Onboarding] Permission request failed:', result?.error);
        setErrors(prev => ({ ...prev, inputMonitoring: true }));
      }
    } catch (error) {
      console.error("Error requesting input monitoring permission:", error);
      setChecking(false);
      setErrors(prev => ({ ...prev, inputMonitoring: true }));
    }
  };



  const handleCheckInputMonitoring = async () => {
    // Check if permission is now granted
    setChecking(true);
    try {
      const result = await window.electron?.checkPermissions();
      if (result && !result.needIM) {
        // Permission granted - auto advance
        setPermissions(prev => ({ ...prev, inputMonitoring: true }));
        setChecking(false);
        nextStep();
      } else {
        // Permission still not granted
        setChecking(false);
        setErrors(prev => ({ ...prev, inputMonitoring: true }));
      }
    } catch (error) {
      console.error("Error checking input monitoring permission:", error);
      setChecking(false);
      setErrors(prev => ({ ...prev, inputMonitoring: true }));
    }
  };

  const handleRequestAccessibility = async () => {
    setChecking(true);
    try {
      await window.electron?.requestAccessibilityPermission();
      // Poll for permission changes
      const pollInterval = setInterval(async () => {
        const result = await window.electron?.checkPermissions();
        if (result && !result.needAX) {
          setPermissions(prev => ({ ...prev, accessibility: true }));
          setChecking(false);
          clearInterval(pollInterval);
          nextStep();
        }
      }, 1000);
      
      // Stop polling after 10 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        setChecking(false);
      }, 10000);
    } catch (error) {
      console.error("Error requesting accessibility permission:", error);
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

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0
    },
    exit: { 
      opacity: 0, 
      y: -20
    }
  };

  // GIF placeholder component
  const GIFPlaceholder: React.FC<{ step: string }> = ({ step }) => (
    <div className="flex items-center justify-center h-full">
              <div className="w-64 h-48 card-elevated rounded-lg flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-2">🎬</div>
            <div className="text-xs text-dimmed">GIF: {step} Demo</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-screen text-foreground onboarding-window">
      {/* Development Mode Indicator */}
      {isDev && (
        <div className="absolute top-4 right-4 z-50 card-floating rounded-lg px-3 py-1">
          <span className="text-xs font-medium text-orange-300">Development Mode</span>
        </div>
      )}
      
      {/* Left Column - Content */}
      <div className="flex-1 flex flex-col justify-center p-6 relative min-h-0">
        <div className="max-w-md w-full mx-auto flex-1 flex flex-col justify-center">
          
          {/* Progress indicator */}
          {currentStep !== "welcome" && currentStep !== "complete" && (
            <motion.div 
              className="flex items-center justify-center space-x-2 mb-6"
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
                className="text-center space-y-6"
              >
                <div className="space-y-3">
                  <h1 className="text-2xl font-medium heading-gradient">Welcome to Sonic Flow</h1>
                  <p className="text-sm text-subtle leading-relaxed">
                    Let's set up the permissions you need for voice dictation.
                  </p>
                </div>
                
                <div className="card-elevated rounded-lg p-4 space-y-3">
                  <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Required Permissions</h2>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-3">
                      <div className="w-1 h-1 bg-primary rounded-full"></div>
                      <span className="text-xs text-subtle">Microphone access to hear your voice</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-1 h-1 bg-primary rounded-full"></div>
                      <span className="text-xs text-subtle">Fn key monitoring for activation</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-1 h-1 bg-primary rounded-full"></div>
                      <span className="text-xs text-subtle">Text insertion for dictation</span>
                    </div>
                  </div>
                </div>
                
                <Button onClick={nextStep} className="w-full">
                  Continue
                </Button>
              </motion.div>
            )}

            {/* Location Step */}
            {currentStep === "location" && (
              <motion.div
                key="location"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-6"
              >
                <div className="space-y-3">
                  <div className="text-2xl mb-3">📁</div>
                  <h2 className="text-xl font-medium heading-gradient">App Location</h2>
                  <p className="text-sm text-subtle leading-relaxed">
                    Sonic Flow needs to be in your Applications folder for it to work correctly.
                  </p>
                </div>
                
                <div className="card-elevated rounded-lg p-4 text-left">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Why this is important</h3>
                  <p className="text-xs text-dimmed leading-relaxed">
                    macOS only applies permission changes to apps that are in the Applications folder.
                    If Sonic Flow is not in Applications, it won't be able to monitor your Fn key.
                  </p>
                </div>

                <div className="space-y-3">
                  <Button 
                    onClick={() => window.electron?.openSystemPreferences("location")}
                    className="w-full"
                  >
                    Move Sonic Flow to Applications
                  </Button>
                  
                  {needsLocationFix && (
                    <div className="space-y-2">
                      <p className="text-xs text-red-400 text-center">Sonic Flow is not in Applications. Please move it.</p>
                      <Button 
                        variant="secondary"
                        onClick={() => window.electron?.openSystemPreferences("location")}
                        className="w-full"
                      >
                        Open System Preferences
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Microphone Step */}
            {currentStep === "microphone" && (
              <motion.div
                key="microphone"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-6"
              >
                <div className="space-y-3">
                  <div className="text-2xl mb-3">🎤</div>
                  <h2 className="text-xl font-medium heading-gradient">Microphone Access</h2>
                  <p className="text-sm text-subtle leading-relaxed">
                    We need access to your microphone to hear what you're saying.
                  </p>
                </div>
                
                <div className="card-elevated rounded-lg p-4 text-left">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Why we need this</h3>
                  <p className="text-xs text-dimmed leading-relaxed">
                    Sonic Flow listens to your voice and converts it to text. 
                    Without microphone access, voice dictation won't work.
                  </p>
                </div>

                <div className="space-y-3">
                  <Button 
                    onClick={handleRequestMicrophone} 
                    disabled={checking}
                    className="w-full"
                  >
                    {checking ? "Requesting..." : "Enable Microphone"}
                  </Button>
                  
                  {errors.microphone && (
                    <div className="space-y-2">
                      <p className="text-xs text-red-400 text-center">Permission denied. Please enable manually:</p>
                      <Button 
                        variant="secondary"
                        onClick={() => window.electron?.openSystemPreferences("microphone")}
                        className="w-full"
                      >
                        Open System Preferences
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Input Monitoring Step */}
            {currentStep === "input-monitoring" && (
              <motion.div
                key="input-monitoring"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-6"
              >
                <div className="space-y-3">
                  <div className="text-2xl mb-3">⌨️</div>
                  <h2 className="text-xl font-medium heading-gradient">Fn Key Monitoring</h2>
                  <p className="text-sm text-subtle leading-relaxed">
                    We need to watch for the Fn key to start and stop dictation.
                  </p>
                </div>
                
                <div className="card-elevated rounded-lg p-4 text-left">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Why we need this</h3>
                  <p className="text-xs text-dimmed leading-relaxed">
                    Press and hold the Fn key to activate voice dictation. 
                    This permission lets us detect when you press it.
                  </p>
                  {isDev && (
                    <div className="mt-3 p-2 bg-orange-500/10 border border-orange-500/30 rounded text-xs text-orange-300">
                      <strong>Dev Mode:</strong> Look for "Electron" or "Cursor" in System Preferences → Privacy & Security → Input Monitoring
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Button 
                    onClick={handleRequestInputMonitoring} 
                    disabled={checking}
                    className="w-full"
                  >
                    {checking ? "Registering in System Settings..." : "Enable Input Monitoring"}
                  </Button>
                  
                  {errors.inputMonitoring && (
                    <div className="space-y-2">
                      <p className="text-xs text-red-400 text-center">Permission not yet granted. Please enable in System Preferences.</p>
                      <Button 
                        variant="secondary"
                        onClick={() => window.electron?.openSystemPreferences("input-monitoring")}
                        className="w-full"
                      >
                        Open System Preferences
                      </Button>
                    </div>
                  )}
                  
                  <Button 
                    onClick={handleCheckInputMonitoring}
                    variant="secondary"
                    disabled={checking}
                    className="w-full"
                  >
                    {checking ? "Checking..." : "I've Enabled It"}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Accessibility Step */}
            {currentStep === "accessibility" && (
              <motion.div
                key="accessibility"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-6"
              >
                <div className="space-y-3">
                  <div className="text-2xl mb-3">📋</div>
                  <h2 className="text-xl font-medium heading-gradient">Text Insertion</h2>
                  <p className="text-sm text-subtle leading-relaxed">
                    We need permission to insert transcribed text where your cursor is.
                  </p>
                </div>
                
                <div className="card-elevated rounded-lg p-4 text-left">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Why we need this</h3>
                  <p className="text-xs text-dimmed leading-relaxed">
                    After converting your voice to text, we need to paste it 
                    into your active application (like a document or email).
                  </p>
                </div>

                <div className="space-y-3">
                  <Button 
                    onClick={handleRequestAccessibility} 
                    disabled={checking}
                    className="w-full"
                  >
                    {checking ? "Requesting..." : "Enable Accessibility"}
                  </Button>
                </div>
              </motion.div>
            )}



            {/* Test Step */}
            {currentStep === "test" && (
              <motion.div
                key="test"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-6"
              >
                <div className="space-y-3">
                  <div className="text-2xl mb-3">🎉</div>
                  <h2 className="text-xl font-medium heading-gradient">Ready to Test!</h2>
                  <p className="text-sm text-subtle leading-relaxed">
                    All permissions are set up. Let's test your dictation!
                  </p>
                </div>
                
                <div className="card-elevated rounded-lg p-4 text-left">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">How to test</h3>
                  <div className="space-y-1 text-xs text-dimmed">
                    <p>1. Click "Start App" below</p>
                    <p>2. Open any text app (Notes, TextEdit, etc.)</p>
                    <p>3. Hold the Fn key and speak</p>
                    <p>4. Release Fn and watch the magic! ✨</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <Button 
                    onClick={handleComplete}
                    className="w-full"
                  >
                    Start Sonic Flow
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
                className="text-center space-y-6"
              >
                <div className="text-primary text-4xl mb-4">✓</div>
                <h2 className="text-xl font-medium heading-gradient">All Set!</h2>
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
                setCurrentStep("test");
              }}
              className="px-4 py-2"
            >
              Skip Setup
            </Button>
          </div>
        )}
      </div>

      {/* Right Column - GIF Placeholder */}
      <div className="flex-1 lg:border-l border-border bg-muted/10 hidden lg:block">
        <AnimatePresence mode="wait">
          {currentStep === "microphone" && (
            <motion.div
              key="microphone-gif"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4 }}
            >
              <GIFPlaceholder step="Microphone Permission" />
            </motion.div>
          )}
          
          {currentStep === "input-monitoring" && (
            <motion.div
              key="input-monitoring-gif"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4 }}
            >
              <GIFPlaceholder step="Input Monitoring" />
            </motion.div>
          )}
          
          {currentStep === "accessibility" && (
            <motion.div
              key="accessibility-gif"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4 }}
            >
              <GIFPlaceholder step="Accessibility" />
            </motion.div>
          )}
          

          
          {(currentStep === "welcome" || currentStep === "test" || currentStep === "complete") && (
            <motion.div
              key="default-visual"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center h-full"
            >
              <div className="text-center">
                <div className="text-6xl mb-4">🎤</div>
                <div className="text-sm text-subtle">Sonic Flow</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
};

export default Onboarding;