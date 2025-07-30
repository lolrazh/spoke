# Sonic Flow - Implementation Plan
## macOS Dictation App Permission & State Issues

### Overview
This document provides detailed implementation plans for fixing 4 critical issues in the Sonic Flow macOS dictation app. Each problem is assigned to a separate agent with complete context, ELI5 explanations, and step-by-step solutions.

---

## 🎯 **PROBLEM 1: Input Monitoring Permission Check is Broken**

### **Agent Assignment**: Input Monitoring Permission Agent

### **Context & ELI5 Understanding**

**What's Happening**: 
The app thinks it already has permission to watch your keyboard (Input Monitoring), so it skips the entire permission setup step during onboarding. It's like a security guard who always says "you're good to go" without actually checking your ID.

**Why This Happens**:
- Apple changed how Input Monitoring works in macOS Ventura/Sonoma
- The old method `IOHIDManagerOpen()` always returns "success" even when permission is denied
- Your app uses this broken check and thinks everything is fine

**Technical Root Cause**:
- File: `native/sonic-helper.c` lines 25-40
- Function `check_input_monitoring_permission()` uses deprecated API
- The check always returns `true` regardless of actual permission status

### **Filemap**
```
native/sonic-helper.c
├── Lines 25-40: check_input_monitoring_permission() - BROKEN
├── Lines 42-65: register_input_monitoring() - Works but wrong binary
└── Lines 150-170: --check-permissions flag handler

src/main.ts
├── Lines 1400-1450: check-permissions IPC handler
└── Lines 1500-1550: request-input-monitoring-permission handler

src/components/Onboarding.tsx
├── Lines 100-120: Auto-check permissions on mount
└── Lines 130-150: handleCheckInputMonitoring function
```

### **Solution Strategy**
1. **Replace the broken API** with modern `IOHIDCheckAccess()`
2. **Update the permission check logic** to properly detect granted/denied status
3. **Test the fix** to ensure onboarding stops at the correct step

### **Implementation Steps**

#### Step 1.1: Update Native Helper Permission Check
**File**: `native/sonic-helper.c`
**Lines**: 25-40

**What to do**:
- Replace `check_input_monitoring_permission()` function
- Use `IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)` instead of `IOHIDManagerOpen()`
- Return proper boolean based on access type

**Code to implement**:
```c
bool check_input_monitoring_permission() {
    IOHIDAccessType accessType = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
    return (accessType == kIOHIDAccessTypeGranted);
}
```

#### Step 1.2: Update Permission Check Handler
**File**: `native/sonic-helper.c`
**Lines**: 150-170

**What to do**:
- Update the `--check-permissions` flag handler
- Ensure it properly reports Input Monitoring status
- Add detailed logging for debugging

#### Step 1.3: Test the Fix
**Files**: `src/main.ts`, `src/components/Onboarding.tsx`

**What to do**:
- Verify onboarding stops at Input Monitoring step when permission is denied
- Confirm permission detection works in both dev and production
- Test the auto-advance logic when permission is already granted

### **Success Criteria**
- [ ] Onboarding stops at Input Monitoring step when permission is denied
- [ ] Permission check returns accurate status
- [ ] Auto-advance works when permission is already granted
- [ ] No false positives in permission detection

---

## 🎯 **PROBLEM 2: App Doesn't Appear in Input Monitoring Settings**

### **Agent Assignment**: System Settings Registration Agent

### **Context & ELI5 Understanding**

**What's Happening**:
When you click "Enable Input Monitoring", macOS opens System Settings but "Sonic Flow" doesn't appear in the Input Monitoring list. It's like trying to add someone to a group chat, but their name never shows up in the invite list.

**Why This Happens**:
- The helper binary (`sonic-helper`) calls `IOHIDRequestAccess()`
- System Settings shows the app that makes the API call
- Since the helper has bundle ID `com.sonicflow.helper`, that's what appears in settings
- Users see "sonic-helper" instead of "Sonic Flow"

**Technical Root Cause**:
- File: `native/sonic-helper.c` lines 42-65
- The wrong binary is requesting permission
- Bundle ID mismatch between helper and main app

### **Filemap**
```
native/sonic-helper.c
├── Lines 42-65: register_input_monitoring() - Wrong binary
└── Lines 170-190: --register-input-monitoring flag

src/main.ts
├── Lines 1500-1550: request-input-monitoring-permission handler
└── Lines 1600-1650: IPC handlers for permissions

forge.config.ts
├── Lines 15-25: Code signing configuration
└── Lines 5-10: Bundle ID configuration

build/entitlements/
├── main.plist: Main app entitlements
└── inherit.plist: Helper entitlements
```

### **Solution Strategy**
1. **Move permission request to main app** instead of helper
2. **Create native module** for Input Monitoring requests
3. **Update bundle configuration** for consistency
4. **Ensure proper code signing** for both binaries

### **Implementation Steps**

#### Step 2.1: Create Native Module for Input Monitoring
**File**: Create new file `native/input-monitoring.mm`

**What to do**:
- Create Objective-C++ module for Input Monitoring
- Implement `IOHIDRequestAccess()` call from main app
- Add proper error handling and logging

**Code structure**:
```objc
#import <IOKit/hid/IOHIDManager.h>

extern "C" {
    bool requestInputMonitoringPermission();
    bool checkInputMonitoringStatus();
}
```

#### Step 2.2: Update Main Process Handler
**File**: `src/main.ts`
**Lines**: 1500-1550

**What to do**:
- Replace helper-based permission request with native module
- Update `request-input-monitoring-permission` handler
- Add proper error handling and user feedback

#### Step 2.3: Update Bundle Configuration
**File**: `forge.config.ts`
**Lines**: 5-25

**What to do**:
- Ensure consistent bundle IDs
- Update code signing for both main app and helper
- Configure proper entitlements

#### Step 2.4: Update Entitlements
**Files**: `build/entitlements/main.plist`, `build/entitlements/inherit.plist`

**What to do**:
- Add Input Monitoring entitlements
- Ensure both binaries have consistent permissions
- Remove any conflicting entitlements

### **Success Criteria**
- [ ] "Sonic Flow" appears in System Settings → Privacy & Security → Input Monitoring
- [ ] Permission request opens correct settings pane
- [ ] App appears with proper name and icon
- [ ] Toggle works correctly in settings

---

## 🎯 **PROBLEM 3: Loading State Never Clears in Production**

### **Agent Assignment**: State Management Agent

### **Context & ELI5 Understanding**

**What's Happening**:
After you finish dictating and release the Fn key, the app gets stuck showing a loading spinner. It's like a traffic light that turns green but never goes back to red, leaving you wondering if the intersection is working.

**Why This Happens**:
- Race condition between state updates
- `setProcessing(false)` happens after `setText(result.text)`
- UI effect waits for all three conditions to be true in the same tick
- React's development mode double-rendering hides this bug

**Technical Root Cause**:
- File: `src/hooks/useTranscription.ts` lines 275-279
- File: `src/components/App.tsx` lines 175-180
- State update order creates timing issues
- Effect dependency array doesn't handle race conditions

### **Filemap**
```
src/hooks/useTranscription.ts
├── Lines 275-279: setProcessing(false) - Too late
├── Lines 270-275: setText(result.text) - Happens first
└── Lines 280-285: Audio cleanup

src/components/App.tsx
├── Lines 175-180: useEffect for processing complete
├── Lines 50-80: Pill state machine
└── Lines 200-250: PTT event handlers
```

### **Solution Strategy**
1. **Fix state update order** - Set processing to false first
2. **Improve effect logic** - Handle race conditions properly
3. **Add proper cleanup** - Ensure state consistency
4. **Test in production** - Verify fix works in minified builds

### **Implementation Steps**

#### Step 3.1: Fix State Update Order
**File**: `src/hooks/useTranscription.ts`
**Lines**: 270-285

**What to do**:
- Move `setProcessing(false)` before `setText(result.text)`
- Add proper error handling
- Ensure cleanup happens in correct order

**Code to implement**:
```typescript
// Instead of:
setText(result.text);
setProcessing(false);

// Do:
setProcessing(false);
setText(result.text);
```

#### Step 3.2: Improve Effect Logic
**File**: `src/components/App.tsx`
**Lines**: 175-180

**What to do**:
- Update the useEffect that handles processing complete
- Add proper dependency management
- Handle edge cases and race conditions

#### Step 3.3: Add State Consistency Checks
**File**: `src/hooks/useTranscription.ts`
**Lines**: 280-295

**What to do**:
- Add cleanup function for state consistency
- Ensure audio resources are properly released
- Add error boundaries for state management

#### Step 3.4: Test Production Build
**What to do**:
- Build production version
- Test multiple dictation cycles
- Verify loading state clears properly
- Test error scenarios

### **Success Criteria**
- [ ] Loading state clears within 1-2 seconds after dictation
- [ ] No stuck spinners in production builds
- [ ] Multiple dictation cycles work correctly
- [ ] Error states are handled gracefully

---

## 🎯 **PROBLEM 4: Keychain Prompts Every Launch**

### **Agent Assignment**: Code Signing Agent

### **Context & ELI5 Understanding**

**What's Happening**:
Every time you open the app, macOS asks for permission to access "Sonic Flow Safe Storage". It's like having to show your ID every time you enter a building, even though you've been there before and should be recognized.

**Why This Happens**:
- Using "Apple Development" certificate which changes signature on every build
- Electron's `safeStorage` creates keychain items tied to the app signature
- When signature changes, macOS treats it as a different app
- Other apps (Wispr Flow, Aqua) use stable Developer ID certificates

**Technical Root Cause**:
- File: `forge.config.ts` lines 15-25
- Certificate type causes signature changes
- Inconsistent entitlements between builds
- Electron's safeStorage triggers keychain prompts

### **Filemap**
```
forge.config.ts
├── Lines 15-25: osxSign configuration
├── Lines 5-10: Bundle ID settings
└── Lines 30-40: Extra resources

build/entitlements/
├── main.plist: Main app entitlements
└── inherit.plist: Helper entitlements

package.json
├── Lines 1-20: Build scripts
└── Lines 30-40: Dependencies
```

### **Solution Strategy**
1. **Switch to Developer ID certificate** for stable signatures
2. **Ensure consistent entitlements** across builds
3. **Update build configuration** for production signing
4. **Test keychain behavior** after changes

### **Implementation Steps**

#### Step 4.1: Update Code Signing Configuration
**File**: `forge.config.ts`
**Lines**: 15-25

**What to do**:
- Replace "Apple Development" with "Developer ID Application"
- Update identity to use stable certificate
- Configure proper signing options

**Code to implement**:
```typescript
osxSign: {
  identity: "Developer ID Application: Your Name (TEAM_ID)",
  hardenedRuntime: true,
  signatureFlags: "runtime",
  entitlements: "./build/entitlements/main.plist",
  entitlementsInherit: "./build/entitlements/inherit.plist",
  preAutoEntitlements: false,
}
```

#### Step 4.2: Update Entitlements
**Files**: `build/entitlements/main.plist`, `build/entitlements/inherit.plist`

**What to do**:
- Ensure consistent entitlements between main app and helper
- Add proper keychain access entitlements
- Remove any conflicting permissions

#### Step 4.3: Update Build Scripts
**File**: `package.json`
**Lines**: 1-20

**What to do**:
- Add proper build scripts for production
- Configure notarization if needed
- Add development vs production build targets

#### Step 4.4: Test Keychain Behavior
**What to do**:
- Build with new certificate
- Install and launch app
- Verify no keychain prompts on subsequent launches
- Test across different macOS versions

### **Success Criteria**
- [ ] No keychain prompts on app launch
- [ ] Stable signature across builds
- [ ] Proper entitlements for all binaries
- [ ] Works on different macOS versions

---

## 📋 **AGENT INSTRUCTIONS**

### **For Each Agent**

1. **Read the complete context** for your assigned problem
2. **Understand the ELI5 explanation** - this helps with debugging
3. **Review the filemap** to know exactly which files to modify
4. **Follow the implementation steps** in order
5. **Test your changes** before moving to next step
6. **Document any issues** or unexpected behavior
7. **Report success criteria** completion

### **Communication Protocol**

- **Before starting**: Confirm understanding of the problem
- **During implementation**: Report progress on each step
- **After completion**: Provide test results and any remaining issues
- **If blocked**: Request additional context or clarification

### **Testing Requirements**

Each agent must test their changes in:
- Development mode
- Production build (if applicable)
- Different macOS versions (if applicable)
- Various user scenarios

### **Success Metrics**

- **Problem 1**: Onboarding stops correctly at permission step
- **Problem 2**: App appears properly in System Settings
- **Problem 3**: Loading state clears within 2 seconds
- **Problem 4**: No keychain prompts on subsequent launches

---

## 🚀 **READY TO BEGIN**

Each agent should:
1. **Acknowledge their assignment**
2. **Confirm understanding** of the problem and solution
3. **Begin with Step 1** of their implementation plan
4. **Report progress** after each step completion

**Start with Problem 1** (Input Monitoring Permission) as it's most critical for the onboarding flow. 