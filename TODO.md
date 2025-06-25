# TODO List - Sonic Flow

## High Priority Tasks

### 1. Remove Duplicate Tray Menu Implementation
**Status**: ✅ VERIFIED - Issue exists  
**Priority**: High  
**Description**: There are duplicate tray menus - one native tray menu and one custom pill context menu both showing "Home" and "Exit" options.

**Current Implementation**:
- Native tray menu in `createTray()` function (lines 168-220 in `src/main.ts`)
- Custom pill context menu via IPC handler `show-pill-context-menu` (lines 366-385 in `src/main.ts`)
- Both menus have identical functionality

**Task**: Keep the native tray menu and remove the duplicate pill context menu implementation.

**Files to modify**:
- `src/main.ts` - Remove IPC handler for `show-pill-context-menu`
- `src/components/Pill.tsx` - Remove `handleContextMenu` function (lines 47-54)
- `src/preload.ts` - Remove `showPillContextMenu` method (lines 18-20)

---

### 2. Fix Helper Process Restart Loop on Permission Denial
**Status**: ✅ VERIFIED - Issue exists  
**Priority**: High  
**Description**: When the fn-tap helper loses permissions, it creates a restart loop every 5 seconds that could confuse users.

**Current Implementation**:
- Helper restart is handled by `scheduleRestart()` function (lines 781-798 in `src/main.ts`)
- Permission handling is in place but restart still occurs on some error conditions
- Delay is 5 seconds for 'close' events, 10 seconds for other errors

**Task**: 
1. Ensure `fnPermissionDenied` flag properly prevents restart loops
2. Surface a tray notification: "Grant Input Monitoring permission → restart"
3. Only auto-restart on crashes, not permission denials

**Files to modify**:
- `src/main.ts` - Improve `scheduleRestart()` logic and permission handling

---

### 3. Prevent AudioWorklet Processor Double Registration
**Status**: ✅ VERIFIED - Issue exists  
**Priority**: High  
**Description**: AudioWorklet processor can be registered twice (once from TypeScript, once from JavaScript), causing Chromium errors.

**Current Implementation**:
- Worklet JS lives in `public/audioworklet-processor.js`
- TS version is also registered in development mode
- No protection against double registration

**Task**: Add registration check with `if (!workletAlreadyRegistered)` gate before calling `audioWorklet.addModule()`.

**Files to modify**:
- `src/hooks/useTranscription.ts` - Add worklet registration tracking (lines 372-373, 463-470)
- Consider creating a global worklet registry

---

## Medium Priority Tasks

### 4. Consolidate Duplicated Audio Constants
**Status**: ✅ VERIFIED - Issue exists  
**Priority**: Medium  
**Description**: `TARGET_SAMPLE_RATE` and related audio constants appear in multiple files.

**Current Locations**:
- `src/hooks/useTranscription.ts` - `TARGET_AUDIO_CONTEXT_RATE = 16000` (line 5)
- `src/workers/local-worker.ts` - `TARGET_SAMPLE_RATE = 16000` (line 50)
- `src/workers/groq-transcriber.ts` - Hard-coded '16000' in headers (line 32)
- `src/audio/ring-buffer.ts` - `SAMPLE_RATE_16K = 16000` (line 8)

**Task**: Create `src/config/audio.ts` and export all audio constants from one place.

**Files to create**:
- `src/config/audio.ts`

**Files to modify**:
- All files using audio constants

---

### 5. Implement Typed Worker Messages
**Status**: ✅ VERIFIED - Issue exists  
**Priority**: Medium  
**Description**: Worker messages use hand-rolled status strings ('asr_model_ready', 'partial', 'completed') without type safety.

**Current Implementation**:
- Messages are string-based in `src/workers/local-worker.ts` (lines 252, 276)
- No shared types between worker and hook

**Task**: Create typed `WorkerMessage` interface with union types and share between worker and hook.

**Proposed Type**:
```typescript
type WorkerMessage = 
  | { type: 'asr_model_ready'; payload?: unknown }
  | { type: 'partial'; payload: { text: string } }
  | { type: 'completed'; payload: { transcription: string; timings: Record<string, number> } }
  | { type: 'error'; payload: { error: string } }
```

**Files to create**:
- `src/types/worker-messages.ts`

**Files to modify**:
- `src/workers/local-worker.ts`
- `src/hooks/useTranscription.ts`

---

## Low Priority Tasks

### 6. Fix Clipboard Paste Functionality
**Status**: ✅ VERIFIED - Issue noted in TODO  
**Priority**: Low  
**Description**: Clipboard paste functionality is reported as not working.

**Current Implementation**:
- Clipboard functionality exists in `src/main.ts` (line 298)
- Text insertion via `insertTextAtCursor` IPC handler

**Task**: Debug and fix clipboard paste mechanism. Test with different applications and edge cases.

**Files to investigate**:
- `src/main.ts` - IPC handlers for text insertion
- Text insertion logic and fallback mechanisms

---

### 7. Implement Latency Telemetry Logging
**Status**: ✅ VERIFIED - Code exists but not logging to file  
**Priority**: Low  
**Description**: Timing data is computed (`allDisjointTimings`) but only logged to console.

**Current Implementation**:
- Timing computation in `src/hooks/useTranscription.ts` (lines 602-622)
- Currently only `console.table(allDisjointTimings)` and `console.log()`

**Task**: Push timing data to main process → file system logging.

**Implementation Plan**:
1. Add IPC method `window.electron.logTelemetry(timings)`
2. Create `ipcMain.handle('log-telemetry')` that appends to `timings.log`
3. Call telemetry logging after timing calculations

**Files to modify**:
- `src/preload.ts` - Add telemetry method
- `src/main.ts` - Add IPC handler for file logging
- `src/hooks/useTranscription.ts` - Call telemetry logging

---

## Task Summary
- **High Priority**: 3 tasks (UI/UX and stability issues)
- **Medium Priority**: 2 tasks (code quality and type safety)
- **Low Priority**: 2 tasks (nice-to-have improvements)

**Estimated Development Time**: 2-3 days for an experienced developer
**Recommended Order**: Complete high priority tasks first, then medium priority for better maintainability.