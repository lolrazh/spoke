import React, { useState, useEffect } from "react";
import { Button } from "./ui/button";

type OnboardingStep = "welcome" | "microphone" | "input-monitoring" | "accessibility" | "test" | "complete";

const Onboarding: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const [permissions, setPermissions] = useState({
    microphone: false,
    inputMonitoring: false,
    accessibility: false,
  });
  const [checking, setChecking] = useState(false);

  // Function to check permissions (we'll expand this later for individual permissions)
  const checkPermissions = async () => {
    try {
      const result = await window.electron?.checkPermissions();
      setPermissions({
        microphone: true, // TODO: Add actual microphone permission check
        inputMonitoring: !result.needIM,
        accessibility: !result.needAX,
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
    const steps: OnboardingStep[] = ["welcome", "microphone", "input-monitoring", "accessibility", "test", "complete"];
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const prevStep = () => {
    const steps: OnboardingStep[] = ["welcome", "microphone", "input-monitoring", "accessibility", "test", "complete"];
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
    }
  };

  // Permission handlers
  const handleRequestMicrophone = async () => {
    setChecking(true);
    try {
      // TODO: Add actual microphone permission request
      console.log("Requesting microphone permission...");
      // Simulate success for now
      setTimeout(() => {
        setPermissions(prev => ({ ...prev, microphone: true }));
        setChecking(false);
        nextStep();
      }, 1000);
    } catch (error) {
      console.error("Error requesting microphone permission:", error);
      setChecking(false);
    }
  };

  const handleRequestInputMonitoring = async () => {
    setChecking(true);
    try {
      await window.electron?.requestInputMonitoringPermission();
      // Poll for permission changes
      const pollInterval = setInterval(async () => {
        const result = await window.electron?.checkPermissions();
        if (!result.needIM) {
          setPermissions(prev => ({ ...prev, inputMonitoring: true }));
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
      console.error("Error requesting input monitoring permission:", error);
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
      test: 4,
      complete: 5,
    };
    return stepMap[currentStep];
  };

  const totalSteps = 4; // welcome, mic, input, accessibility

  return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8">
      <div className="max-w-md w-full space-y-6">
        
        {/* Progress indicator */}
        {currentStep !== "welcome" && currentStep !== "complete" && (
          <div className="flex items-center justify-center space-x-2 mb-8">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-full ${
                  i < getStepNumber()
                    ? "bg-green-500"
                    : i === getStepNumber()
                    ? "bg-blue-500"
                    : "bg-gray-600"
                }`}
              />
            ))}
          </div>
        )}

        {/* Welcome Step */}
        {currentStep === "welcome" && (
          <div className="text-center space-y-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">Welcome to Sonic Flow</h1>
              <p className="text-gray-300">
                Let's set up the permissions you need for voice dictation.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">We'll need to enable:</h2>
              <div className="space-y-2 text-left">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span>Microphone access to hear your voice</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span>Fn key monitoring for activation</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span>Text insertion for dictation</span>
                </div>
              </div>
            </div>
            <Button onClick={nextStep} className="w-full">
              Let's Get Started
            </Button>
          </div>
        )}

        {/* Microphone Step */}
        {currentStep === "microphone" && (
          <div className="text-center space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">🎤 Microphone Access</h2>
              <p className="text-gray-300">
                We need access to your microphone to hear what you're saying.
              </p>
            </div>
            
            <div className="bg-gray-800 rounded-lg p-6 text-left">
              <h3 className="font-semibold mb-2">Why we need this:</h3>
              <p className="text-gray-300 text-sm">
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
          </div>
        )}

        {/* Input Monitoring Step */}
        {currentStep === "input-monitoring" && (
          <div className="text-center space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">⌨️ Fn Key Monitoring</h2>
              <p className="text-gray-300">
                We need to watch for the Fn key to start and stop dictation.
              </p>
            </div>
            
            <div className="bg-gray-800 rounded-lg p-6 text-left">
              <h3 className="font-semibold mb-2">Why we need this:</h3>
              <p className="text-gray-300 text-sm">
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
                 {checking ? "Requesting..." : "Enable Input Monitoring"}
               </Button>
               
               <Button 
                 variant="secondary" 
                 onClick={prevStep}
                 className="w-full"
               >
                 Back
               </Button>
             </div>
          </div>
        )}

        {/* Accessibility Step */}
        {currentStep === "accessibility" && (
          <div className="text-center space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">📋 Text Insertion</h2>
              <p className="text-gray-300">
                We need permission to insert transcribed text where your cursor is.
              </p>
            </div>
            
            <div className="bg-gray-800 rounded-lg p-6 text-left">
              <h3 className="font-semibold mb-2">Why we need this:</h3>
              <p className="text-gray-300 text-sm">
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
          </div>
        )}

        {/* Test Step */}
        {currentStep === "test" && (
          <div className="text-center space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">🎉 Ready to Test!</h2>
              <p className="text-gray-300">
                All permissions are set up. Let's test your dictation!
              </p>
            </div>
            
            <div className="bg-gray-800 rounded-lg p-6 text-left">
              <h3 className="font-semibold mb-2">How to test:</h3>
              <div className="space-y-2 text-sm text-gray-300">
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
          </div>
        )}

        {/* Complete Step */}
        {currentStep === "complete" && (
          <div className="text-center space-y-6">
            <div className="text-green-500 text-6xl mb-4">✓</div>
            <h2 className="text-2xl font-bold mb-2">All Set!</h2>
            <p className="text-gray-300">
              Sonic Flow is ready to use. Enjoy your voice dictation!
            </p>
          </div>
        )}

      </div>
    </div>
  );
};

export default Onboarding;