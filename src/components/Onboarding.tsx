import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";

type OnboardingStep = "welcome" | "microphone" | "input-monitoring" | "accessibility" | "restart" | "test" | "complete";

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

  // Function to check permissions
  const checkPermissions = async () => {
    try {
      const [systemPerms, micPerms] = await Promise.all([
        window.electron?.checkPermissions(),
        window.electron?.checkMicrophonePermission()
      ]);
      
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
    checkPermissions();
  }, []);

  // Navigation functions
  const nextStep = () => {
    const steps: OnboardingStep[] = ["welcome", "microphone", "input-monitoring", "accessibility", "restart", "test", "complete"];
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const prevStep = () => {
    const steps: OnboardingStep[] = ["welcome", "microphone", "input-monitoring", "accessibility", "restart", "test", "complete"];
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
    setChecking(true);
    try {
      await window.electron?.requestInputMonitoringPermission();
      
      // After opening System Preferences, show instructions and provide manual continue
      setChecking(false);
      // Don't auto-advance - let user manually continue after granting permission
    } catch (error) {
      console.error("Error requesting input monitoring permission:", error);
      setChecking(false);
    }
  };

  const handleCheckInputMonitoring = async () => {
    setChecking(true);
    try {
      const result = await window.electron?.checkPermissions();
      if (!result?.needIM) {
        setPermissions(prev => ({ ...prev, inputMonitoring: true }));
        setChecking(false);
        nextStep();
      } else {
        setChecking(false);
        setErrors(prev => ({ ...prev, inputMonitoring: true }));
      }
    } catch (error) {
      console.error("Error checking input monitoring permission:", error);
      setChecking(false);
    }
  };

  const handleRequestAccessibility = async () => {
    setChecking(true);
    try {
      await window.electron?.requestAccessibilityPermission();
      // Poll for permission changes
      const pollInterval = setInterval(async () => {
        const result = await window.electron?.checkPermissions();
        if (!result.needAX) {
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

  const handleRestart = async () => {
    try {
      // Complete onboarding first, then restart
      await window.electron?.onboardingComplete();
      setTimeout(() => {
        window.electron?.reloadApp();
      }, 500);
    } catch (error) {
      console.error("Error restarting app:", error);
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
  const getStepNumber = () => {
    const stepMap = {
      welcome: 0,
      microphone: 1,
      "input-monitoring": 2,
      accessibility: 3,
      restart: 4,
      test: 5,
      complete: 6,
    };
    return stepMap[currentStep];
  };

  const totalSteps = 5; // welcome, mic, input, accessibility, restart

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
              <div className="w-64 h-48 bg-sonic-gray/20 rounded-lg border border-sonic-gray/30 flex items-center justify-center">
          <div className="text-center">
            <div className="text-3xl mb-2">🎬</div>
            <div className="text-xs text-sonic-light/60">GIF: {step} Demo</div>
          </div>
        </div>
    </div>
  );

  return (
    <div className="flex h-full text-white bg-sonic-dark">
      {/* Draggable header bar */}
      <div className="header-bar absolute top-0 left-0 right-0 h-8 z-50"></div>
      
      {/* Left Column - Content */}
      <div className="flex-1 flex flex-col justify-center p-6">
        <div className="max-w-sm w-full mx-auto">
          
          {/* Progress indicator */}
          {currentStep !== "welcome" && currentStep !== "complete" && (
            <motion.div 
              className="flex items-center justify-center space-x-2 mb-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {Array.from({ length: totalSteps }, (_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                    i < getStepNumber()
                      ? "bg-sonic-light"
                      : i === getStepNumber()
                      ? "bg-sonic-primary"
                      : "bg-sonic-gray/40"
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
                  <h1 className="text-2xl font-medium text-white">Welcome to Sonic Flow</h1>
                  <p className="text-sm text-sonic-light/80 leading-relaxed">
                    Let's set up the permissions you need for voice dictation.
                  </p>
                </div>
                
                <div className="bg-sonic-gray/30 border border-sonic-gray/50 rounded-lg p-4 space-y-3">
                  <h2 className="text-xs font-medium text-sonic-light uppercase tracking-wide">Required Permissions</h2>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-3">
                      <div className="w-1 h-1 bg-sonic-primary rounded-full"></div>
                      <span className="text-xs text-sonic-light/80">Microphone access to hear your voice</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-1 h-1 bg-sonic-primary rounded-full"></div>
                      <span className="text-xs text-sonic-light/80">Fn key monitoring for activation</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-1 h-1 bg-sonic-primary rounded-full"></div>
                      <span className="text-xs text-sonic-light/80">Text insertion for dictation</span>
                    </div>
                  </div>
                </div>
                
                <Button onClick={nextStep} className="w-full">
                  Continue
                </Button>
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
                  <h2 className="text-xl font-medium text-white">Microphone Access</h2>
                  <p className="text-sm text-sonic-light/80 leading-relaxed">
                    We need access to your microphone to hear what you're saying.
                  </p>
                </div>
                
                <div className="bg-sonic-gray/30 border border-sonic-gray/50 rounded-lg p-4 text-left">
                  <h3 className="text-xs font-medium text-sonic-light uppercase tracking-wide mb-2">Why we need this</h3>
                  <p className="text-xs text-sonic-light/60 leading-relaxed">
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
                  
                  {getStepNumber() > 1 && (
                    <Button 
                      variant="secondary" 
                      onClick={prevStep}
                      className="w-full"
                    >
                      Back
                    </Button>
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
                  <h2 className="text-xl font-medium text-white">Fn Key Monitoring</h2>
                  <p className="text-sm text-sonic-light/80 leading-relaxed">
                    We need to watch for the Fn key to start and stop dictation.
                  </p>
                </div>
                
                <div className="bg-sonic-gray/30 border border-sonic-gray/50 rounded-lg p-4 text-left">
                  <h3 className="text-xs font-medium text-sonic-light uppercase tracking-wide mb-2">Why we need this</h3>
                  <p className="text-xs text-sonic-light/60 leading-relaxed">
                    Press and hold the Fn key to activate voice dictation. 
                    This permission lets us detect when you press it.
                  </p>
                </div>

                <div className="space-y-3">
                  <Button 
                    onClick={handleRequestInputMonitoring} 
                    disabled={checking}
                    className="w-full"
                  >
                    {checking ? "Opening System Preferences..." : "Enable Input Monitoring"}
                  </Button>
                  
                  {errors.inputMonitoring && (
                    <div className="space-y-2">
                      <p className="text-xs text-red-400 text-center">Permission not yet granted. Please enable in System Preferences.</p>
                      <Button 
                        variant="secondary"
                        onClick={() => window.electron?.openSystemPreferences("inputmonitoring")}
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
                  
                  <Button 
                    variant="secondary" 
                    onClick={prevStep}
                    className="w-full"
                  >
                    Back
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
                  <h2 className="text-xl font-medium text-white">Text Insertion</h2>
                  <p className="text-sm text-sonic-light/80 leading-relaxed">
                    We need permission to insert transcribed text where your cursor is.
                  </p>
                </div>
                
                <div className="bg-sonic-gray/30 border border-sonic-gray/50 rounded-lg p-4 text-left">
                  <h3 className="text-xs font-medium text-sonic-light uppercase tracking-wide mb-2">Why we need this</h3>
                  <p className="text-xs text-sonic-light/60 leading-relaxed">
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
                  
                  <Button 
                    variant="secondary" 
                    onClick={prevStep}
                    className="w-full"
                  >
                    Back
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Restart Step */}
            {currentStep === "restart" && (
              <motion.div
                key="restart"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="text-center space-y-6"
              >
                <div className="space-y-3">
                  <div className="text-2xl mb-3">🔄</div>
                  <h2 className="text-xl font-medium text-white">Restart Required</h2>
                  <p className="text-sm text-sonic-light/80 leading-relaxed">
                    macOS needs Sonic Flow to restart to activate the new permissions.
                  </p>
                </div>
                
                <div className="bg-sonic-gray/30 border border-sonic-gray/50 rounded-lg p-4 text-left">
                  <h3 className="text-xs font-medium text-sonic-light uppercase tracking-wide mb-2">Why restart is needed</h3>
                  <p className="text-xs text-sonic-light/60 leading-relaxed">
                    macOS only applies permission changes to apps after they restart. 
                    This ensures your privacy settings are properly enforced.
                  </p>
                </div>

                <div className="space-y-3">
                  <Button 
                    onClick={handleRestart}
                    className="w-full"
                  >
                    Restart Sonic Flow
                  </Button>
                  
                  <Button 
                    variant="secondary" 
                    onClick={prevStep}
                    className="w-full"
                  >
                    Back
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
                  <h2 className="text-xl font-medium text-white">Ready to Test!</h2>
                  <p className="text-sm text-sonic-light/80 leading-relaxed">
                    All permissions are set up. Let's test your dictation!
                  </p>
                </div>
                
                <div className="bg-sonic-gray/30 border border-sonic-gray/50 rounded-lg p-4 text-left">
                  <h3 className="text-xs font-medium text-sonic-light uppercase tracking-wide mb-2">How to test</h3>
                  <div className="space-y-1 text-xs text-sonic-light/60">
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
                  
                  <Button 
                    variant="secondary" 
                    onClick={prevStep}
                    className="w-full"
                  >
                    Back
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
                <div className="text-sonic-light text-4xl mb-4">✓</div>
                <h2 className="text-xl font-medium text-white">All Set!</h2>
                <p className="text-sm text-sonic-light/80 leading-relaxed">
                  Sonic Flow is ready to use. Enjoy your voice dictation!
                </p>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>

      {/* Right Column - GIF Placeholder */}
      <div className="flex-1 border-l border-sonic-gray/30 bg-sonic-gray/10">
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
          
          {currentStep === "restart" && (
            <motion.div
              key="restart-gif"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4 }}
              className="flex items-center justify-center h-full"
            >
              <div className="text-center">
                <div className="text-6xl mb-4">🔄</div>
                <div className="text-sm text-sonic-light/80">Restarting Sonic Flow</div>
                <div className="text-xs text-sonic-light/60 mt-2">Applying permissions...</div>
              </div>
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
                <div className="text-sm text-sonic-light/80">Sonic Flow</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
};

export default Onboarding;