/**
 * Mock Permission System
 * Simulates permission APIs for seamless UI development
 */

import devFlags from '../config/devFlags';

// Types for permission responses
interface PermissionResult {
  success: boolean;
  granted?: boolean;
  status?: string;
  mock?: boolean;
}

interface SystemPermissionResult {
  needAX: boolean;
  needIM: boolean;
  isDev: boolean;
  mock?: boolean;
}

interface MicrophonePermissionResult {
  status: string;
  granted: boolean;
  mock?: boolean;
}

type PermissionState = 'granted' | 'denied' | 'prompt';

class MockPermissionService {
  private permissionStates: Record<string, PermissionState>;
  private requestedPermissions: Set<string>;

  constructor() {
    this.permissionStates = {
      microphone: devFlags.simulatePermissionStates.microphone as PermissionState,
      accessibility: devFlags.simulatePermissionStates.accessibility as PermissionState,
      inputMonitoring: devFlags.simulatePermissionStates.inputMonitoring as PermissionState
    };
    
    // Track which permissions have been "requested" during this session
    this.requestedPermissions = new Set();
    
    devFlags.methods.devLog('MockPermissionService initialized with states:', this.permissionStates);
  }

  // Mock microphone permission check
  async checkMicrophonePermission(): Promise<MicrophonePermissionResult> {
    if (!devFlags.mockPermissionStates) {
      // Fallback to real permission check
      const result = await (window as any).electron?.checkMicrophonePermission?.();
      return result || { status: 'denied', granted: false };
    }

    const state = this.permissionStates.microphone;
    devFlags.methods.devLog('Mock microphone check:', state);
    
    return {
      status: state,
      granted: state === 'granted',
      mock: true
    };
  }

  // Mock microphone permission request
  async requestMicrophonePermission(): Promise<PermissionResult> {
    if (!devFlags.mockPermissionStates) {
      const result = await (window as any).electron?.requestMicrophonePermission?.();
      return result || { success: false };
    }

    const currentState = this.permissionStates.microphone;
    devFlags.methods.devLog('Mock microphone request, current state:', currentState);
    
    // Simulate async permission dialog
    await this.simulatePermissionDialog('microphone');
    
    let newState: PermissionState;
    if (currentState === 'prompt') {
      // Simulate user granting permission
      newState = Math.random() > 0.3 ? 'granted' : 'denied';
      this.permissionStates.microphone = newState;
      devFlags.methods.devNotify(`Mock: Microphone permission ${newState}`);
    } else {
      newState = currentState;
    }

    this.requestedPermissions.add('microphone');
    
    return {
      success: true,
      granted: newState === 'granted',
      mock: true
    };
  }

  // Mock system permissions check (accessibility, input monitoring)
  async checkPermissions(): Promise<SystemPermissionResult> {
    if (!devFlags.mockPermissionStates) {
      const result = await (window as any).electron?.checkPermissions?.();
      return result || { needAX: true, needIM: true, isDev: false };
    }

    const needAX = this.permissionStates.accessibility !== 'granted';
    const needIM = this.permissionStates.inputMonitoring !== 'granted';
    
    devFlags.methods.devLog('Mock permissions check:', { needAX, needIM });
    
    return {
      needAX,
      needIM,
      isDev: devFlags.isDevelopment,
      mock: true
    };
  }

  // Mock accessibility permission request
  async requestAccessibilityPermission(): Promise<PermissionResult> {
    if (!devFlags.mockPermissionStates) {
      const result = await (window as any).electron?.requestAccessibilityPermission?.();
      return result || { success: false };
    }

    devFlags.methods.devLog('Mock accessibility permission request');
    await this.simulatePermissionDialog('accessibility');
    
    if (this.permissionStates.accessibility === 'prompt') {
      this.permissionStates.accessibility = 'granted';
      devFlags.methods.devNotify('Mock: Accessibility permission granted');
    }

    this.requestedPermissions.add('accessibility');
    
    return {
      success: true,
      mock: true
    };
  }

  // Mock input monitoring permission request
  async askIM(): Promise<PermissionResult> {
    if (!devFlags.mockPermissionStates) {
      const result = await (window as any).electron?.askIM?.();
      return result || { success: false };
    }

    devFlags.methods.devLog('Mock input monitoring request');
    await this.simulatePermissionDialog('inputMonitoring');
    
    let status = this.permissionStates.inputMonitoring;
    if (status === 'prompt') {
      status = Math.random() > 0.2 ? 'granted' : 'denied';
      this.permissionStates.inputMonitoring = status;
      devFlags.methods.devNotify(`Mock: Input monitoring ${status}`);
    }

    this.requestedPermissions.add('inputMonitoring');
    
    return {
      success: true,
      status: status === 'granted' ? 'authorized' : 'denied',
      mock: true
    };
  }

  // Mock opening system preferences
  async openSystemPreferences(pane: string): Promise<PermissionResult> {
    if (!devFlags.mockPermissionStates) {
      const result = await (window as any).electron?.openSystemPreferences?.(pane);
      return result || { success: false };
    }

    devFlags.methods.devLog(`Mock: Opening System Preferences for ${pane}`);
    devFlags.methods.devNotify(`Mock: Would open System Preferences → ${pane}`);
    
    // Simulate the user granting permission after opening settings
    setTimeout(() => {
      if (this.permissionStates[pane] === 'denied') {
        this.permissionStates[pane] = 'granted';
        devFlags.methods.devNotify(`Mock: ${pane} permission now granted`);
      }
    }, 2000);
    
    return { success: true, mock: true };
  }

  // Simulate permission dialog delay
  private async simulatePermissionDialog(permissionType: string): Promise<void> {
    if (devFlags.disablePermissionDialogs) {
      return;
    }

    const delay = devFlags.fastAnimations ? 100 : 800;
    devFlags.methods.devLog(`Simulating ${permissionType} permission dialog (${delay}ms)`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // Get current state of all permissions
  getAllPermissionStates(): Record<string, any> {
    return {
      ...this.permissionStates,
      requested: Array.from(this.requestedPermissions),
      mock: true
    };
  }

  // Set permission state for testing
  setPermissionState(permission: string, state: PermissionState): void {
    if (!devFlags.mockPermissionStates) return;
    
    this.permissionStates[permission] = state;
    devFlags.methods.devLog(`Mock: Set ${permission} to ${state}`);
    devFlags.methods.devNotify(`Mock: ${permission} → ${state}`);
  }

  // Reset all permissions to initial state
  resetPermissions(): void {
    if (!devFlags.mockPermissionStates) return;
    
    this.permissionStates = {
      microphone: devFlags.simulatePermissionStates.microphone as PermissionState,
      accessibility: devFlags.simulatePermissionStates.accessibility as PermissionState,
      inputMonitoring: devFlags.simulatePermissionStates.inputMonitoring as PermissionState
    };
    this.requestedPermissions.clear();
    
    devFlags.methods.devLog('Mock: Reset all permissions');
    devFlags.methods.devNotify('Mock: Permissions reset');
  }
}

// Create singleton instance
const mockPermissions = new MockPermissionService();

// Development helper methods for console
if (devFlags.isDevelopment && typeof window !== 'undefined') {
  window.mockPermissions = {
    setState: (permission, state) => mockPermissions.setPermissionState(permission, state),
    getStates: () => mockPermissions.getAllPermissionStates(),
    reset: () => mockPermissions.resetPermissions(),
    grant: (permission) => mockPermissions.setPermissionState(permission, 'granted'),
    deny: (permission) => mockPermissions.setPermissionState(permission, 'denied'),
    prompt: (permission) => mockPermissions.setPermissionState(permission, 'prompt')
  };
}

export default mockPermissions;