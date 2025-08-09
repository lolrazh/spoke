# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Sonic Flow** is a lightweight AI dictation app for macOS, built with Electron, React, TypeScript, and Tailwind CSS. It provides a floating pill interface for push-to-talk dictation with real-time transcription and text insertion.

## Key Development Commands

### Essential Scripts
- `npm start` - Start development server (Electron Forge + Vite)
- `npm run package` - Package app for arm64 architecture
- `npm run make` - Create DMG installer for distribution
- `npm run lint` - Run ESLint on TypeScript/TSX files
- `npm run clean` - Clean build output directory

### Development Environment
- `./dev-onboarding.sh` - Enhanced development mode with mock permissions and debug features
- `./test-onboarding.sh` - Test onboarding flow scenarios  
- `./test-permission-scenarios.sh` - Test different permission states

### Native Components
- `./native/build-helper.sh` - Build native helper binary (runs automatically on postinstall)
- Native helper handles system permissions (accessibility, input monitoring) and hotkey detection

## Architecture Overview

### Core Architecture
- **Main Process** (`src/main.ts`): Electron main process handling window management, system permissions, IPC, and native helper coordination
- **Renderer Process** (`src/renderer.tsx`): React app entry point
- **Preload Script** (`src/preload.ts`): Secure bridge between main and renderer processes

### Key Components
- **App Component** (`src/components/App.tsx`): Main application logic with pill state machine
- **Pill Component** (`src/components/Pill.tsx`): Floating UI element for dictation interface
- **Onboarding Component** (`src/components/Onboarding.tsx`): Permission setup and user onboarding flow
- **useTranscription Hook** (`src/hooks/useTranscription.ts`): Core transcription logic and audio processing

### Window System
- **Main Window**: Floating pill interface (transparent, always-on-top, click-through)
- **Onboarding Window**: Permission setup and configuration (vibrancy effects on macOS)
- **Position Constants**: `src/constants/window.ts` and `src/constants/onboarding.ts`

### State Management
- Pill state machine with states: IDLE, LISTENING, PROCESSING, NOTIFICATION, HOVER_PREVIEW, EXPANDED
- Managed through React useReducer in App.tsx
- IPC communication between main and renderer processes

### Design System
- **CSS Variables**: Defined in `src/index.css` for colors, surfaces, and motion tokens
- **Tailwind Config**: `tailwind.config.js` with custom design tokens and glassmorphic shadows
- **Component Library**: UI components in `src/components/ui/` (button, select, switch)
- **Design Tokens**: Configuration files in `src/config/` for consistent styling

### Native Integration
- **Helper Binary**: `native/sonic-helper.c` compiled to macOS app bundle
- **Permissions**: Handles microphone, accessibility, and input monitoring permissions
- **Hotkey Detection**: Function key press/release detection for push-to-talk
- **Text Insertion**: Direct text insertion at cursor position via accessibility APIs

### Audio Processing
- Web Audio API with AudioWorklet for real-time processing
- Custom audio processor: `public/audioworklet-processor.js`
- Microphone device management and selection
- Audio feedback with WAV file playback

### Build System
- **Vite**: Modern build tool with multiple entry points (main, preload, renderer)
- **Electron Forge**: Application packaging and distribution
- **TypeScript**: Full type safety with path aliases (`@/*` → `src/*`)
- **Code Signing**: Configured for macOS development certificates

## Important Patterns

### IPC Communication
- Use strongly typed IPC handlers defined in `src/types/electron.d.ts`
- All IPC calls return promises with proper error handling
- Context bridge ensures secure communication between processes

### Permission Management
- Always check permissions before requesting
- Use native helper for consistent cross-environment permission checks
- Handle permission denial gracefully with user guidance

### State Synchronization
- Pill state drives window visibility and click-through behavior
- Microphone selection synced between renderer and main process via IPC
- Notification system broadcasts messages to all windows

### Error Handling
- Graceful degradation when native components unavailable
- User-friendly error messages via notification system
- Comprehensive logging for debugging

## TypeScript Configuration Patterns

### Path Aliases and Module Resolution
The project uses TypeScript path aliases for clean imports:
```typescript
// tsconfig.json configuration
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@/components/*": ["src/components/*"],
      "@/hooks/*": ["src/hooks/*"],
      "@/services/*": ["src/services/*"],
      "@/types/*": ["src/types/*"],
      "@/config/*": ["src/config/*"]
    }
  }
}
```

### IPC Type Safety
All IPC communication uses strongly typed interfaces:
```typescript
// src/types/electron.d.ts - Main type definitions
interface ElectronAPI {
  // Transcription IPC
  startTranscription: () => Promise<boolean>;
  stopTranscription: () => Promise<void>;
  
  // Permission IPC  
  checkPermissions: () => Promise<PermissionStates>;
  requestPermissions: (type: PermissionType) => Promise<boolean>;
  
  // Window management
  showOnboarding: () => Promise<void>;
  hideOnboarding: () => Promise<void>;
}

// Usage in renderer with full type safety
const result = await window.electronAPI.checkPermissions();
// result is fully typed as PermissionStates
```

### Type Definitions for Native Integration
```typescript
// src/types/native.d.ts - Native helper types
interface PermissionStates {
  microphone: PermissionState;
  accessibility: PermissionState;
  inputMonitoring: PermissionState;
}

type PermissionState = 'granted' | 'denied' | 'unknown';
type PermissionType = 'microphone' | 'accessibility' | 'inputMonitoring';

// Native helper result types
interface NativeHelperResult {
  success: boolean;
  error?: string;
  data?: any;
}
```

### Build-Time Type Checking
```bash
# Comprehensive type checking across all entry points
npm run type-check:main     # Check main process types
npm run type-check:preload  # Check preload script types  
npm run type-check:renderer # Check renderer process types
npm run type-check:all      # Check all processes
```

## IPC Debugging Workflow

### Enable IPC Debug Logging
```typescript
// In main.ts - Enable detailed IPC logging
if (process.env.NODE_ENV === 'development') {
  ipcMain.on('*', (event, ...args) => {
    console.log(`[IPC] Channel: ${event.type}`, args);
  });
}

// Environment variable for IPC debugging
SF_DEBUG_IPC=1 npm start
```

### Common IPC Issues and Solutions

#### 1. Context Bridge Security Violations
```typescript
// ❌ Wrong - Direct exposure of Node APIs
contextBridge.exposeInMainWorld('electronAPI', {
  fs: require('fs'), // Security violation!
});

// ✅ Correct - Wrapped APIs only
contextBridge.exposeInMainWorld('electronAPI', {
  readConfig: () => ipcRenderer.invoke('read-config'),
});
```

#### 2. IPC Handler Registration Issues  
```typescript
// Main process - Register handlers before app ready
ipcMain.handle('check-permissions', async () => {
  try {
    return await nativeHelper.checkPermissions();
  } catch (error) {
    console.error('[IPC] Permission check failed:', error);
    throw error; // Re-throw for renderer error handling
  }
});

// Renderer process - Always handle promise rejections
try {
  const permissions = await window.electronAPI.checkPermissions();
} catch (error) {
  console.error('[IPC] Failed to check permissions:', error);
  // Handle error state in UI
}
```

#### 3. IPC Communication Timing Issues
```typescript
// Wait for DOM ready before IPC calls
document.addEventListener('DOMContentLoaded', async () => {
  // Safe to make IPC calls now
  const permissions = await window.electronAPI.checkPermissions();
});

// Use proper cleanup for IPC listeners
useEffect(() => {
  const cleanup = window.electronAPI.onPermissionChange((newState) => {
    setPermissions(newState);
  });
  
  return cleanup; // Prevent memory leaks
}, []);
```

### IPC Debugging Tools
```bash
# Enable Electron's built-in IPC debugging
ELECTRON_DEBUG=1 npm start

# Debug specific IPC channels  
SF_DEBUG_CHANNELS="transcription,permissions" npm start

# Monitor IPC performance
SF_DEBUG_IPC_PERFORMANCE=1 npm start
```

### Testing IPC Communication
```typescript
// src/tests/ipc.test.ts - IPC integration tests
describe('IPC Communication', () => {
  test('permission check IPC works correctly', async () => {
    const mockPermissions = { microphone: 'granted' };
    mockIPC('check-permissions', mockPermissions);
    
    const result = await window.electronAPI.checkPermissions();
    expect(result).toEqual(mockPermissions);
  });
});
```

## Performance Monitoring

### Electron App Performance Metrics
```typescript
// src/services/performance.ts - Performance monitoring service
class PerformanceMonitor {
  static monitorRenderer() {
    // Memory usage tracking
    setInterval(() => {
      const memory = (performance as any).memory;
      if (memory) {
        console.log('[PERF] Memory:', {
          used: Math.round(memory.usedJSHeapSize / 1024 / 1024) + 'MB',
          total: Math.round(memory.totalJSHeapSize / 1024 / 1024) + 'MB',
          limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024) + 'MB'
        });
      }
    }, 10000);
  }
  
  static monitorIPC() {
    const start = performance.now();
    return {
      end: () => {
        const duration = performance.now() - start;
        if (duration > 100) { // Log slow IPC calls
          console.warn(`[PERF] Slow IPC call took ${duration.toFixed(2)}ms`);
        }
      }
    };
  }
}
```

### Main Process Performance
```typescript
// In main.ts - Monitor main process resources
setInterval(() => {
  const memoryUsage = process.memoryUsage();
  console.log('[PERF] Main Process Memory:', {
    rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
    external: Math.round(memoryUsage.external / 1024 / 1024) + 'MB'
  });
}, 30000);

// CPU usage monitoring
const { spawn } = require('child_process');
const psProcess = spawn('ps', ['-p', process.pid.toString(), '-o', 'pcpu']);
```

### Audio Processing Performance
```typescript
// Monitor AudioWorklet performance
// public/audioworklet-processor.js
class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const startTime = performance.now();
    
    // Audio processing logic here...
    
    const processingTime = performance.now() - startTime;
    if (processingTime > 5) { // Log slow audio processing
      this.port.postMessage({
        type: 'performance-warning',
        processingTime
      });
    }
    
    return true;
  }
}
```

### Native Helper Performance
```bash
# Monitor native helper process
ps aux | grep sonic-helper
top -pid $(pgrep sonic-helper)

# Performance profiling with dtrace (macOS)
sudo dtrace -n 'proc:::exec-success /execname == "sonic-helper"/ { printf("%s %s\n", execname, curpsinfo->pr_psargs); }'
```

### Performance Debug Commands
```bash
# Enable performance debugging
SF_DEBUG_PERFORMANCE=1 npm start

# Memory leak detection
SF_DEBUG_MEMORY=1 npm start

# Audio processing performance  
SF_DEBUG_AUDIO_PERFORMANCE=1 npm start

# Profile startup time
time npm start
```

### Performance Thresholds and Alerts
```typescript
// src/config/performance.ts - Performance thresholds
export const PERFORMANCE_THRESHOLDS = {
  IPC_CALL_MAX_MS: 100,
  AUDIO_PROCESSING_MAX_MS: 5,
  MEMORY_WARNING_MB: 200,
  MEMORY_CRITICAL_MB: 500,
  STARTUP_TIME_MAX_MS: 3000,
  TRANSCRIPTION_DELAY_MAX_MS: 200
};
```

## Native Helper Debugging

### Building and Testing Native Helper
```bash
# Build native helper with debug symbols
cd native
gcc -g -O0 -DDEBUG sonic-helper.c -framework CoreFoundation -framework ApplicationServices -o sonic-helper-debug

# Run with debugging information
./sonic-helper-debug --debug --verbose

# Memory debugging with AddressSanitizer
gcc -fsanitize=address -g sonic-helper.c -framework CoreFoundation -framework ApplicationServices -o sonic-helper-asan
```

### Permission Debugging Techniques
```bash
# Check current permission states
./sonic-helper check-permissions --verbose

# Debug accessibility permission issues
./sonic-helper test-accessibility --debug

# Test input monitoring permissions
./sonic-helper test-input-monitoring --debug

# Verify microphone access
./sonic-helper test-microphone --debug
```

### Common Native Helper Issues

#### 1. Permission Dialog Not Appearing
```c
// In sonic-helper.c - Force permission dialog
CFStringRef appName = CFSTR("Sonic Flow");
AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)@{
    (__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES
});
```

#### 2. Hotkey Detection Not Working
```bash
# Debug hotkey event capture
sudo dtruss -p $(pgrep sonic-helper) 2>&1 | grep CGEvent

# Test function key detection manually
./sonic-helper test-hotkey --key=F18 --debug
```

#### 3. Text Insertion Failures
```c
// Debug text insertion in native helper
void debug_text_insertion(const char* text) {
    NSLog(@"[DEBUG] Attempting to insert text: %s", text);
    
    // Check if we have accessibility permissions
    if (!AXIsProcessTrusted()) {
        NSLog(@"[ERROR] No accessibility permissions for text insertion");
        return;
    }
    
    // Test basic text insertion
    CGEventRef keyEvent = CGEventCreateKeyboardEvent(NULL, kVK_Space, true);
    CGEventPost(kCGHIDEventTap, keyEvent);
    CFRelease(keyEvent);
}
```

### Native Helper Logging
```bash
# Enable detailed native helper logging
export SF_NATIVE_DEBUG=1
export SF_NATIVE_VERBOSE=1

# View system logs for native helper
log stream --predicate 'process == "sonic-helper"'

# Monitor native helper crashes
log show --last 1h --predicate 'eventType == logEvent AND processImagePath CONTAINS "sonic-helper"'
```

### Debugging Permission System Integration
```typescript
// src/services/permissions.ts - Debug permission checks
class PermissionDebugger {
  static async debugPermissionFlow() {
    console.group('[PERM-DEBUG] Starting permission check flow');
    
    try {
      // Check native helper availability
      const helperAvailable = await this.checkNativeHelper();
      console.log('[PERM-DEBUG] Native helper available:', helperAvailable);
      
      if (!helperAvailable) {
        console.warn('[PERM-DEBUG] Native helper not available, using fallback');
        return this.useFallbackPermissions();
      }
      
      // Check each permission individually
      const permissions = ['microphone', 'accessibility', 'inputMonitoring'];
      for (const perm of permissions) {
        const status = await this.checkSinglePermission(perm);
        console.log(`[PERM-DEBUG] ${perm}:`, status);
      }
      
    } finally {
      console.groupEnd();
    }
  }
}
```

### Code Signing and Entitlements Debug
```bash
# Verify code signing of native helper
codesign -vv ./native/sonic-helper

# Check entitlements
codesign -d --entitlements :- ./native/sonic-helper

# Debug entitlements in main app
codesign -d --entitlements :- ./out/Sonic\ Flow-darwin-arm64/Sonic\ Flow.app
```

### System Integration Testing
```bash
# Test complete permission flow
./test-permission-scenarios.sh --debug

# Test with different system states
sudo ./test-system-integration.sh

# Simulate permission denial scenarios  
./test-permission-denial.sh --verbose
```

## Testing and Development

### Development Flags
- `SF_DEV_ONBOARDING=1` - Enhanced onboarding features
- `SF_DEV_SKIP_PERMISSIONS=true` - Skip system permission checks
- `SF_DEV_MOCK_PERMS=true` - Use mock permission states
- `SF_DESIGN_MODE=1` - Enable design system debug features

### Mock Permissions
- Configurable via environment variables for UI development
- `SF_MOCK_MIC_STATE`, `SF_MOCK_AX_STATE`, `SF_MOCK_IM_STATE`
- Service in `src/services/mockPermissions.ts`

### Debugging
- DevTools automatically open in development mode
- Debug pill with `?debugPill` URL parameter
- Comprehensive trace logging in App component

## File Structure Highlights

### Core Logic
- `src/main.ts` - Main process with window management and system integration
- `src/components/App.tsx` - Application logic and pill state machine
- `src/hooks/useTranscription.ts` - Audio processing and transcription

### Configuration
- `forge.config.ts` - Electron Forge build configuration
- `vite.*.config.ts` - Separate Vite configs for main, preload, and renderer
- `src/config/` - Design tokens and application configuration

### UI and Styling  
- `src/index.css` - Global styles with CSS custom properties
- `src/components/ui/` - Reusable UI component library
- `DESIGN.md` - Comprehensive design system documentation

### Development Tools
- `dev-onboarding.sh` - Development environment setup
- `native/build-helper.sh` - Native component build script
- `test-*.sh` - Testing scripts for different scenarios