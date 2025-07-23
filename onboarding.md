# Complete Onboarding Flow Implementation Plan

## 🎯 Objective
Create a comprehensive, step-by-step onboarding experience that guides users through:
1. **Login/Account Setup** (optional path)
2. **Fn Key Override Configuration** 
3. **System Permissions** (Accessibility + Input Monitoring)
4. **Dictation Testing** with hotkey
5. **Success & Launch** 🎉

## 📱 User Experience Flow

### Step 1: Welcome & Login
```
┌─────────────────────────────────┐
│     Welcome to Sonic Flow!     │
│                                 │
│  🎤 AI-powered dictation for    │
│     macOS professionals         │
│                                 │
│  [Sign In] [Continue as Guest]  │
│                                 │
│  Account sync • Cloud backup    │
│  Custom models • Pro features   │
└─────────────────────────────────┘
```

### Step 2: Fn Key Setup
```
┌─────────────────────────────────┐
│    Configure Your Hotkey       │
│                                 │
│  🔑 We use the Fn key for      │
│     quick dictation access     │
│                                 │
│  📋 Hold Fn → Start recording  │
│     Release → Stop & paste     │
│                                 │
│  [Configure Fn Key Override]   │
│  [Skip - Use Different Key]    │
└─────────────────────────────────┘
```

### Step 3: System Permissions
```
┌─────────────────────────────────┐
│     Grant Permissions          │
│                                 │
│  ✅ Accessibility              │
│     ↳ [Enable] Required        │
│                                 │
│  ⭕ Input Monitoring           │
│     ↳ [Enable] Required        │
│                                 │
│  Both permissions are needed    │
│  for Sonic Flow to work         │
└─────────────────────────────────┘
```

### Step 4: Test Drive
```
┌─────────────────────────────────┐
│      Test Your Setup           │
│                                 │
│  🎯 Try dictating something:    │
│                                 │
│  "Hello world, this is a test"  │
│                                 │
│  [Hold Fn to Start Recording]  │
│                                 │
│  Status: 🔴 Recording...        │
│          ⏸️  Processing...      │
│          ✅ "Hello world..."    │
└─────────────────────────────────┘
```

### Step 5: Success!
```
┌─────────────────────────────────┐
│         🎉 All Set!            │
│                                 │
│  Sonic Flow is ready to boost   │
│  your productivity!             │
│                                 │
│  💡 Pro tip: Try dictating in   │
│     any text field across macOS │
│                                 │
│     [Start Using Sonic Flow]    │
└─────────────────────────────────┘
```

## 🏗️ Technical Implementation

### State Management
```typescript
interface OnboardingState {
  currentStep: 'welcome' | 'login' | 'fnkey' | 'permissions' | 'test' | 'success';
  user: {
    isLoggedIn: boolean;
    email?: string;
    accountType: 'guest' | 'free' | 'pro';
  };
  permissions: {
    accessibility: boolean;
    inputMonitoring: boolean;
  };
  fnKeyConfigured: boolean;
  testCompleted: boolean;
}
```

### Step Components Architecture
```
src/components/onboarding/
├── OnboardingContainer.tsx     # Main container with step management
├── steps/
│   ├── WelcomeStep.tsx        # Login/guest selection
│   ├── FnKeyStep.tsx          # Fn key configuration
│   ├── PermissionsStep.tsx    # System permissions
│   ├── TestStep.tsx           # Dictation testing
│   └── SuccessStep.tsx        # Completion
├── shared/
│   ├── StepHeader.tsx         # Progress indicator
│   ├── StepNavigation.tsx     # Next/Back buttons
│   └── StatusIndicator.tsx    # Permission status dots
└── OnboardingRouter.tsx       # Step routing logic
```

## 📋 Implementation Steps

### Phase 1: Component Architecture

#### 1.1 Create Onboarding Container
```typescript
// src/components/onboarding/OnboardingContainer.tsx
const OnboardingContainer = () => {
  const [state, setState] = useState<OnboardingState>({
    currentStep: 'welcome',
    user: { isLoggedIn: false, accountType: 'guest' },
    permissions: { accessibility: false, inputMonitoring: false },
    fnKeyConfigured: false,
    testCompleted: false,
  });

  const nextStep = () => { /* Navigate to next step */ };
  const prevStep = () => { /* Go back */ };
  
  return (
    <div className="onboarding-container">
      <StepHeader currentStep={state.currentStep} />
      <OnboardingRouter state={state} setState={setState} />
      <StepNavigation onNext={nextStep} onPrev={prevStep} />
    </div>
  );
};
```

#### 1.2 Progress Indicator
```typescript
// src/components/onboarding/shared/StepHeader.tsx
const steps = [
  { id: 'welcome', label: 'Welcome', icon: '👋' },
  { id: 'fnkey', label: 'Hotkey', icon: '🔑' },
  { id: 'permissions', label: 'Permissions', icon: '🔐' },
  { id: 'test', label: 'Test', icon: '🎯' },
  { id: 'success', label: 'Ready!', icon: '🎉' },
];

const StepHeader = ({ currentStep }) => (
  <div className="step-progress">
    {steps.map((step, index) => (
      <div 
        key={step.id}
        className={`step ${step.id === currentStep ? 'active' : ''}`}
      >
        <span className="step-icon">{step.icon}</span>
        <span className="step-label">{step.label}</span>
      </div>
    ))}
  </div>
);
```

### Phase 2: Individual Steps

#### 2.1 Welcome/Login Step
```typescript
// src/components/onboarding/steps/WelcomeStep.tsx
const WelcomeStep = ({ onNext, setState }) => {
  const handleLogin = async () => {
    // Implement OAuth or email login
    // Set user state
    onNext();
  };

  const handleGuest = () => {
    setState(prev => ({
      ...prev,
      user: { ...prev.user, accountType: 'guest' }
    }));
    onNext();
  };

  return (
    <div className="welcome-step">
      <h1>Welcome to Sonic Flow!</h1>
      <p>AI-powered dictation for macOS professionals</p>
      
      <div className="auth-options">
        <button onClick={handleLogin} className="primary">
          Sign In
        </button>
        <button onClick={handleGuest} className="secondary">
          Continue as Guest
        </button>
      </div>
      
      <div className="benefits">
        <div>✨ Account sync</div>
        <div>☁️ Cloud backup</div>
        <div>🎯 Custom models</div>
        <div>⚡ Pro features</div>
      </div>
    </div>
  );
};
```

#### 2.2 Fn Key Configuration
```typescript
// src/components/onboarding/steps/FnKeyStep.tsx
const FnKeyStep = ({ onNext }) => {
  const [isConfiguring, setIsConfiguring] = useState(false);

  const handleConfigureFnKey = async () => {
    setIsConfiguring(true);
    try {
      // Open macOS System Settings to Keyboard > Keyboard Shortcuts
      await window.electron?.openSystemSettings('keyboard-shortcuts');
      // Show instructions overlay
    } catch (error) {
      console.error('Failed to open system settings:', error);
    }
    setIsConfiguring(false);
  };

  return (
    <div className="fnkey-step">
      <h2>Configure Your Hotkey</h2>
      <div className="hotkey-demo">
        <div className="key-visual">Fn</div>
        <div className="instruction">
          <p>📋 Hold Fn → Start recording</p>
          <p>🔄 Release → Stop & paste</p>
        </div>
      </div>
      
      <div className="configuration-options">
        <button 
          onClick={handleConfigureFnKey}
          className="primary"
          disabled={isConfiguring}
        >
          {isConfiguring ? 'Opening Settings...' : 'Configure Fn Key Override'}
        </button>
        
        <button onClick={onNext} className="secondary">
          Skip - Use Different Key
        </button>
      </div>
      
      <div className="help-text">
        We'll guide you through the system settings
      </div>
    </div>
  );
};
```

#### 2.3 Permissions Step
```typescript
// src/components/onboarding/steps/PermissionsStep.tsx
const PermissionsStep = ({ state, setState, onNext }) => {
  const [checking, setChecking] = useState(false);

  const checkPermissions = async () => {
    setChecking(true);
    try {
      const result = await window.electron?.checkPermissions();
      setState(prev => ({
        ...prev,
        permissions: {
          accessibility: !result.needAX,
          inputMonitoring: !result.needIM,
        }
      }));
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
    setChecking(false);
  };

  const requestAccessibility = async () => {
    try {
      await window.electron?.requestAccessibilityPermission();
      setTimeout(checkPermissions, 1000); // Check after delay
    } catch (error) {
      console.error('Error requesting accessibility:', error);
    }
  };

  const requestInputMonitoring = async () => {
    try {
      await window.electron?.requestInputMonitoringPermission();
      setTimeout(checkPermissions, 1000);
    } catch (error) {
      console.error('Error requesting input monitoring:', error);
    }
  };

  useEffect(() => {
    checkPermissions();
  }, []);

  const allGranted = state.permissions.accessibility && state.permissions.inputMonitoring;

  return (
    <div className="permissions-step">
      <h2>Grant Permissions</h2>
      <p>Both permissions are required for Sonic Flow to work</p>
      
      <div className="permission-list">
        <div className="permission-item">
          <div className="permission-info">
            <h3>Accessibility</h3>
            <p>Required for pasting transcribed text</p>
          </div>
          <div className="permission-status">
            {state.permissions.accessibility ? (
              <span className="status granted">✅ Granted</span>
            ) : (
              <button onClick={requestAccessibility} className="enable-btn">
                Enable
              </button>
            )}
          </div>
        </div>
        
        <div className="permission-item">
          <div className="permission-info">
            <h3>Input Monitoring</h3>
            <p>Required for Fn key detection</p>
          </div>
          <div className="permission-status">
            {state.permissions.inputMonitoring ? (
              <span className="status granted">✅ Granted</span>
            ) : (
              <button onClick={requestInputMonitoring} className="enable-btn">
                Enable
              </button>
            )}
          </div>
        </div>
      </div>
      
      {checking && (
        <div className="checking-status">
          <div className="spinner"></div>
          <p>Checking permissions...</p>
        </div>
      )}
      
      {allGranted && (
        <button onClick={onNext} className="continue-btn primary">
          Continue to Testing
        </button>
      )}
    </div>
  );
};
```

#### 2.4 Dictation Test Step
```typescript
// src/components/onboarding/steps/TestStep.tsx
const TestStep = ({ setState, onNext }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'failed'>('idle');

  const startTestRecording = async () => {
    setIsRecording(true);
    setTranscript('');
    setTestResult('idle');
    
    // Start recording simulation or actual recording
    try {
      // Implementation would connect to actual transcription
      await window.electron?.startTestRecording();
    } catch (error) {
      console.error('Failed to start test recording:', error);
      setTestResult('failed');
    }
  };

  const stopTestRecording = async () => {
    setIsRecording(false);
    try {
      const result = await window.electron?.stopTestRecording();
      setTranscript(result.text);
      setTestResult(result.text ? 'success' : 'failed');
      
      if (result.text) {
        setState(prev => ({ ...prev, testCompleted: true }));
      }
    } catch (error) {
      console.error('Failed to stop test recording:', error);
      setTestResult('failed');
    }
  };

  return (
    <div className="test-step">
      <h2>Test Your Setup</h2>
      <p>Let's make sure everything is working perfectly!</p>
      
      <div className="test-area">
        <div className="suggested-phrase">
          <h3>Try saying:</h3>
          <p className="phrase">"Hello world, this is a test of Sonic Flow dictation."</p>
        </div>
        
        <div className="recording-controls">
          {!isRecording ? (
            <button 
              onClick={startTestRecording}
              className="record-btn primary large"
            >
              🎙️ Hold Fn to Start Recording
            </button>
          ) : (
            <button 
              onClick={stopTestRecording}
              className="record-btn recording large"
            >
              🔴 Recording... (Release Fn to stop)
            </button>
          )}
        </div>
        
        {transcript && (
          <div className="transcript-result">
            <h3>Transcribed:</h3>
            <p className="transcript">{transcript}</p>
          </div>
        )}
        
        {testResult === 'success' && (
          <div className="test-success">
            <div className="success-icon">✅</div>
            <h3>Perfect! Your setup is working!</h3>
            <button onClick={onNext} className="continue-btn primary">
              Complete Setup
            </button>
          </div>
        )}
        
        {testResult === 'failed' && (
          <div className="test-failed">
            <div className="error-icon">❌</div>
            <h3>Something went wrong</h3>
            <p>Let's try again or check your permissions</p>
            <button onClick={startTestRecording} className="retry-btn">
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
```

#### 2.5 Success Step
```typescript
// src/components/onboarding/steps/SuccessStep.tsx
const SuccessStep = () => {
  const handleFinish = async () => {
    try {
      await window.electron?.onboardingComplete();
    } catch (error) {
      console.error('Error completing onboarding:', error);
    }
  };

  return (
    <div className="success-step">
      <div className="celebration">
        <div className="success-icon">🎉</div>
        <h2>All Set!</h2>
        <p>Sonic Flow is ready to boost your productivity!</p>
      </div>
      
      <div className="pro-tips">
        <h3>💡 Pro Tips:</h3>
        <ul>
          <li>Try dictating in any text field across macOS</li>
          <li>Hold Fn longer for better accuracy</li>
          <li>Speak clearly and at normal pace</li>
          <li>Use punctuation commands like "comma" and "period"</li>
        </ul>
      </div>
      
      <div className="final-actions">
        <button onClick={handleFinish} className="finish-btn primary large">
          Start Using Sonic Flow
        </button>
      </div>
      
      <div className="help-links">
        <a href="#" className="help-link">📚 View Documentation</a>
        <a href="#" className="help-link">🎯 Keyboard Shortcuts</a>
        <a href="#" className="help-link">⚙️ Advanced Settings</a>
      </div>
    </div>
  );
};
```

### Phase 3: New IPC Handlers

#### 3.1 System Settings Integration
```typescript
// Add to src/main.ts
ipcMain.handle("open-system-settings", async (_, section: string) => {
  try {
    const urls = {
      'keyboard-shortcuts': 'x-apple.systempreferences:com.apple.preference.keyboard?Keyboard',
      'accessibility': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      'input-monitoring': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    };
    
    if (urls[section]) {
      await shell.openExternal(urls[section]);
      return { success: true };
    }
    
    return { success: false, error: 'Unknown settings section' };
  } catch (error) {
    console.error('Failed to open system settings:', error);
    return { success: false, error: error.message };
  }
});
```

#### 3.2 Test Recording Handlers
```typescript
// Add to src/main.ts
let testRecordingSession: any = null;

ipcMain.handle("start-test-recording", async () => {
  try {
    // Start a test recording session
    testRecordingSession = {
      startTime: Date.now(),
      isActive: true,
    };
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stop-test-recording", async () => {
  try {
    if (testRecordingSession?.isActive) {
      // Simulate or perform actual transcription test
      const duration = Date.now() - testRecordingSession.startTime;
      const mockTranscript = duration > 1000 ? 
        "Hello world, this is a test of Sonic Flow dictation." : 
        "";
      
      testRecordingSession = null;
      return { 
        success: true, 
        text: mockTranscript,
        duration 
      };
    }
    
    return { success: false, error: 'No active recording session' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

## 📝 ELI5 Summary

**Think of it like setting up a new video game:**

1. **Choose Your Player** (Login/Guest): Like creating a character - you can have a full account with saves and upgrades, or just play as a guest.

2. **Configure Your Controller** (Fn Key): We need to set up your "magic button" (the Fn key) so when you press it, the computer knows you want to talk to it.

3. **Grant Game Permissions** (System Access): Like when a game asks "Can I access your microphone?" - we need two permissions so Sonic Flow can listen to you and type what you say.

4. **Tutorial Level** (Test Drive): Every good game has a tutorial! We'll test if everything works by having you say something and seeing if it gets typed correctly.

5. **Ready to Play!** (Success): Now you're all set to use your voice-to-text superpower anywhere on your Mac!

## 🎯 Key Benefits

1. **User-Friendly**: Each step is clear and has helpful visuals
2. **Progressive**: Users can see their progress and feel accomplished
3. **Flexible**: Account creation is optional (guest mode)
4. **Validation**: Each step verifies it worked before moving on
5. **Educational**: Users learn how to use the app during setup
6. **Professional**: Matches the quality of other Mac apps

## 🚀 Next Steps

1. Create the component architecture
2. Implement individual step components
3. Add IPC handlers for new functionality
4. Style the onboarding flow
5. Test the complete user journey
6. Polish and refine based on feedback

This creates a smooth, professional onboarding experience that turns first-time users into confident Sonic Flow power users! 🎉 