/**
 * Development Mode Feature Flags
 * Professional development workflow system inspired by Raycast, VSCode, and Slack
 */

// Types for development configuration
interface DevFlags {
  skipPermissions: boolean;
  mockPermissionStates: boolean;
  showDebugOverlay: boolean;
  fastAnimations: boolean;
  forceOnboarding: boolean;
  designMode: boolean;
  simulatePermissionStates: {
    microphone: string;
    accessibility: string;
    inputMonitoring: string;
  };
  enableHotReload: boolean;
  disablePermissionDialogs: boolean;
  logAllEvents: boolean;
  animationSpeed: number;
  alwaysShowDevMode: boolean;
  isDevelopment: boolean;
  isProduction: boolean;
  isStaging: boolean;
  methods: {
    devLog: (...args: any[]) => void;
    devNotify: (message: string) => void;
    getMockPermissionState: (permissionType: string) => string | null;
    shouldBypass: (feature: string) => boolean;
  };
}

// Detect if we're in development mode
const isDev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

const devFlags = {
  // Core development features
  skipPermissions: isDev || process.env.SF_DEV_SKIP_PERMISSIONS === 'true',
  mockPermissionStates: isDev || process.env.SF_DEV_MOCK_PERMS === 'true',
  showDebugOverlay: isDev || process.env.SF_DEV_DEBUG === 'true',
  fastAnimations: isDev || process.env.SF_DEV_FAST_ANIMS === 'true',
  
  // UI development helpers  
  forceOnboarding: process.env.SF_DEV_ONBOARDING === '1',
  designMode: process.env.SF_DESIGN_MODE === '1',
  
  // Permission simulation modes
  simulatePermissionStates: {
    microphone: process.env.SF_MOCK_MIC_STATE || 'denied', // 'granted', 'denied', 'prompt'
    accessibility: process.env.SF_MOCK_AX_STATE || 'denied',
    inputMonitoring: process.env.SF_MOCK_IM_STATE || 'denied'
  },
  
  // Development workflow features
  enableHotReload: isDev,
  disablePermissionDialogs: isDev || process.env.SF_NO_PERMISSION_DIALOGS === 'true',
  logAllEvents: isDev || process.env.SF_DEV_VERBOSE === 'true',
  
  // Animation speed controls
  animationSpeed: isDev ? 0.1 : 1.0, // 10x faster animations in dev
  
  // Window behavior overrides
  alwaysShowDevMode: isDev || process.env.SF_SHOW_DEV_INDICATOR === 'true'
};

// Environment-specific configurations
const environments = {
  development: {
    ...devFlags,
    skipPermissions: true,
    mockPermissionStates: true,
    showDebugOverlay: true,
    fastAnimations: true
  },
  
  staging: {
    ...devFlags,
    skipPermissions: false,
    mockPermissionStates: false,
    showDebugOverlay: true,
    fastAnimations: false
  },
  
  production: {
    skipPermissions: false,
    mockPermissionStates: false,
    showDebugOverlay: false,
    fastAnimations: false,
    forceOnboarding: false,
    designMode: false,
    enableHotReload: false,
    disablePermissionDialogs: false,
    logAllEvents: false,
    animationSpeed: 1.0,
    alwaysShowDevMode: false
  }
};

// Get current environment config
const currentEnv = process.env.NODE_ENV || 'development';
const config = environments[currentEnv] || environments.development;

// Add runtime detection methods
(config as any).isDevelopment = isDev;
(config as any).isProduction = currentEnv === 'production';
(config as any).isStaging = currentEnv === 'staging';

// Helper methods for common dev tasks
(config as any).methods = {
  // Log development events
  devLog: (...args) => {
    if (config.logAllEvents) {
      console.log('[DEV]', ...args);
    }
  },
  
  // Show notification only in dev mode
  devNotify: (message) => {
    if (isDev && typeof window !== 'undefined' && window.electron) {
      window.electron.showNotification(`[DEV] ${message}`);
    }
  },
  
  // Get mock permission state
  getMockPermissionState: (permissionType) => {
    if (!config.mockPermissionStates) return null;
    return config.simulatePermissionStates[permissionType] || 'granted';
  },
  
  // Check if we should bypass a feature
  shouldBypass: (feature) => {
    const bypasses = {
      'permissions': config.skipPermissions,
      'animations': config.fastAnimations,
      'dialogs': config.disablePermissionDialogs
    };
    return bypasses[feature] || false;
  }
};

export default config as DevFlags;