import React, { useState, useEffect } from "react";
import { Button } from "./ui/button";

const Onboarding: React.FC = () => {
  const [needAX, setNeedAX] = useState(true);
  const [needIM, setNeedIM] = useState(true);
  const [checking, setChecking] = useState(true);
  const [polling, setPolling] = useState(false);

  // Function to check permissions
  const checkPermissions = async () => {
    try {
      const result = await window.electron?.checkPermissions();
      setNeedAX(result.needAX);
      setNeedIM(result.needIM);
      setChecking(false);
      return result.needAX || result.needIM;
    } catch (error) {
      console.error("Error checking permissions:", error);
      setChecking(false);
      return true; // Assume permissions needed on error
    }
  };

  // Poll for permissions
  useEffect(() => {
    if (!polling) return;
    
    const interval = setInterval(async () => {
      const stillNeedsPermissions = await checkPermissions();
      if (!stillNeedsPermissions) {
        setPolling(false);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [polling]);

  useEffect(() => {
    // Check permissions when component mounts
    checkPermissions();
  }, []);

  const handleEnableAccessibility = async () => {
    try {
      await window.electron?.requestAccessibilityPermission();
      // Start polling for permission changes
      setPolling(true);
    } catch (error) {
      console.error("Error requesting accessibility permission:", error);
    }
  };

  const handleEnableInputMonitoring = async () => {
    try {
      await window.electron?.requestInputMonitoringPermission();
      // Start polling for permission changes
      setPolling(true);
    } catch (error) {
      console.error("Error requesting input monitoring permission:", error);
    }
  };

  const handleStartApp = async () => {
    try {
      await window.electron?.startHelper();
      window.electron?.onboardingComplete();
    } catch (error) {
      console.error("Error starting helper:", error);
    }
  };

  const allPermissionsGranted = !needAX && !needIM;

  return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">Welcome to Sonic Flow</h1>
          <p className="text-gray-300">
            To use Sonic Flow, we need to enable some system permissions.
          </p>
        </div>

        {checking ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
            <p className="mt-4">Checking permissions...</p>
          </div>
        ) : (
          <>
            {allPermissionsGranted ? (
              <div className="text-center py-8">
                <div className="text-green-500 text-5xl mb-4">✓</div>
                <h2 className="text-xl font-semibold mb-2">All Set!</h2>
                <p className="text-gray-300 mb-6">
                  Sonic Flow is ready to use. Click below to start the app.
                </p>
                <Button onClick={handleStartApp}>
                  Start Sonic Flow
                </Button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-gray-800 rounded-lg p-6">
                  <h2 className="text-xl font-semibold mb-4">Required Permissions</h2>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-gray-700 rounded">
                      <div>
                        <h3 className="font-medium">Accessibility</h3>
                        <p className="text-sm text-gray-300">
                          Required for pasting text
                        </p>
                      </div>
                      {needAX ? (
                        <Button onClick={handleEnableAccessibility}>
                          Enable
                        </Button>
                      ) : (
                        <span className="text-green-500 font-medium">Enabled</span>
                      )}
                    </div>
                    
                    <div className="flex items-center justify-between p-3 bg-gray-700 rounded">
                      <div>
                        <h3 className="font-medium">Input Monitoring</h3>
                        <p className="text-sm text-gray-300">
                          Required for Fn key detection
                        </p>
                      </div>
                      {needIM ? (
                        <Button onClick={handleEnableInputMonitoring}>
                          Enable
                        </Button>
                      ) : (
                        <span className="text-green-500 font-medium">Enabled</span>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="text-sm text-gray-400">
                  <p>
                    After enabling permissions, you may need to wait a moment for the system to update.
                    The system will prompt you to grant these permissions when you click "Enable".
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Onboarding;