# Sonic Flow Transcription System

Comprehensive documentation for Sonic Flow's real-time audio transcription pipeline, from microphone input to text insertion.

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Audio Processing Pipeline](#audio-processing-pipeline)
4. [Transcription Service Integration](#transcription-service-integration)
5. [Text Insertion System](#text-insertion-system)
6. [State Management](#state-management)
7. [Device Management](#device-management)
8. [Error Handling](#error-handling)
9. [Performance Optimization](#performance-optimization)
10. [Configuration](#configuration)
11. [Debugging and Troubleshooting](#debugging-and-troubleshooting)
12. [API Reference](#api-reference)

---

## Overview

Sonic Flow implements a **real-time audio transcription pipeline** that captures microphone input, processes it through custom audio worklets, sends it to Whisper ASR, and automatically inserts the transcribed text at the cursor position. The system is optimized for low-latency push-to-talk dictation with high accuracy.

### Key Features
- **Real-time Audio Processing** - Custom AudioWorklet with 48kHz→16kHz downsampling
- **Whisper Large v3 Turbo** - State-of-the-art ASR model via api.sonicflow.app
- **Native Text Insertion** - Direct cursor positioning via accessibility APIs
- **Visual Audio Feedback** - Real-time level metering with peak detection
- **Device Management** - Hot-pluggable microphone selection and enumeration
- **Graceful Error Handling** - Comprehensive fallbacks and user feedback

### Core Components
- **useTranscription Hook** (`src/hooks/useTranscription.ts`) - Main transcription orchestrator
- **AudioWorklet Processor** (`public/audioworklet-processor.js`) - Real-time audio processing
- **PCM-to-WAV Utility** (`src/utils/pcm16-to-wav.ts`) - Audio format conversion
- **Native Helper** - macOS accessibility integration for text insertion
- **Audio Feedback System** (`src/utils/audioFeedback.ts`) - Start/stop sound cues

---

## Architecture

### System Flow Diagram
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Microphone    │───▶│   AudioWorklet   │───▶│   PCM Buffer    │
│   (48kHz)       │    │   Processor      │    │   (16kHz)       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Level Meter   │◀───│   RMS/Peak       │    │   WAV Blob      │
│   (Visual FB)   │    │   Calculation    │    │   Creation      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Text Editor   │◀───│   Native Helper  │◀───│   Sonic Flow    │
│   (Cursor)      │    │   (AX APIs)      │    │   API (Whisper) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Process Architecture
- **Main Process** - IPC coordination, native helper management, device enumeration
- **Renderer Process** - UI state, audio processing, transcription requests
- **AudioWorklet Thread** - Real-time audio processing isolated from main thread
- **Native Helper Binary** - macOS accessibility integration and text insertion

---

## Audio Processing Pipeline

### 1. Microphone Capture

#### Configuration
```typescript
// src/config/audio.ts
export const TARGET_AUDIO_CONTEXT_RATE = 48000; // Browser/hardware rate
export const MICROPHONE_PREFERRED_RATE = 48000; // Microphone capture rate
export const TARGET_SAMPLE_RATE = 16000;        // ASR model expected rate
```

#### MediaStream Setup
```typescript
// src/hooks/useTranscription.ts:160-185
const constraints: MediaStreamConstraints = {
  audio: {
    sampleRate: MICROPHONE_PREFERRED_RATE,
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
  },
};
```

**Key Design Decisions:**
- **48kHz Capture**: Matches native hardware rate, prevents browser resampling artifacts
- **Mono Channel**: Reduces processing overhead, sufficient for speech
- **No Processing**: Disabled echo cancellation/noise suppression for minimal latency

### 2. AudioWorklet Processing

#### Real-time Audio Thread
```javascript
// public/audioworklet-processor.js
class CaptureProcessor extends AudioWorkletProcessor {
  // 960 samples per chunk = 60ms at 16kHz
  pcm16 = new Int16Array(960);
  
  process(inputs, outputs, parameters) {
    // Downsample by 3 (48kHz → 16kHz)
    // Convert Float32 → Int16
    // Emit PCM chunks and level data
  }
}
```

#### Downsampling Strategy
- **3:1 Decimation**: Every 3rd sample from 48kHz input (simple but effective)
- **48kHz → 16kHz**: Matches Whisper model requirements
- **60ms Chunks**: 960 samples provides good latency/quality balance

#### Level Metering
```javascript
// Real-time audio level calculation
const rms = Math.sqrt(this._sumSquares / this._samples);
const dbRms = 20 * Math.log10(rms + eps);
const normalized = (dbRms - DB_FLOOR) / -DB_FLOOR;

// Exponential smoothing with asymmetric attack/release
const alpha = raw > smoothLevel ? ATTACK : RELEASE;
smoothLevel = alpha * raw + (1 - alpha) * smoothLevel;
```

**Features:**
- **RMS + Peak Blend**: Combines sustained levels with transient spikes
- **dBFS Normalization**: -60dB floor provides useful dynamic range
- **Asymmetric Smoothing**: Fast attack (0.85), slow release (0.08) for punchy response

### 3. PCM-to-WAV Conversion

#### WAV Header Generation
```typescript
// src/utils/pcm16-to-wav.ts
export function pcm16ToWav(samples: Int16Array, sampleRate = 16000): Blob {
  // Creates standard WAV header for 16-bit mono PCM
  // Handles SharedArrayBuffer compatibility for blob creation
}
```

**Specifications:**
- **Format**: 16-bit PCM, mono, 16kHz
- **Header**: Standard RIFF/WAVE format with proper chunk sizing
- **Compatibility**: Handles SharedArrayBuffer restrictions in modern browsers

---

## Transcription Service Integration

### API Endpoint Configuration
```typescript
// src/hooks/useTranscription.ts:360-363
const response = await fetch("https://api.sonicflow.app", {
  method: "POST",
  body: formData,
});
```

### Request Format
```typescript
// FormData payload structure
formData.append("file", wavBlob, "audio.wav");
formData.append("model", "whisper-large-v3-turbo");
formData.append("language", "en");
formData.append("response_format", "json");
formData.append("temperature", "0");
```

### Model Specifications
- **Whisper Large v3 Turbo**: OpenAI's latest ASR model optimized for speed
- **Language**: English (configurable for future multilingual support)
- **Temperature 0**: Deterministic output for consistency
- **JSON Response**: Structured response with transcribed text

### Response Processing
```typescript
// src/hooks/useTranscription.ts:370-376
const result = await response.json();
setText(result.text);
if (result.text) {
  window.transcript?.update(result.text);  // Context menu functionality
  window.clipboard.insertText(result.text); // Automatic insertion
}
```

---

## Text Insertion System

### Native Helper Integration

#### Binary Location
```typescript
// src/main.ts:1123-1125
const helperPath = app.isPackaged
  ? path.join(process.resourcesPath, "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper")
  : path.join(app.getAppPath(), "native", "bin", "Sonic Flow Helper.app", "Contents", "MacOS", "Sonic Flow Helper");
```

#### Paste-and-Verify Process
```typescript
// src/main.ts:1141-1142
const proc = spawnHelper(helperPath, ["--paste-and-verify", payloadText], false);
```

### Accessibility Integration

#### Permission Requirements
- **Accessibility Access**: Required for cursor positioning and text insertion
- **Input Monitoring**: Required for hotkey detection (future feature)
- **Microphone Access**: Required for audio capture

#### Text Insertion Flow
```
1. Store original clipboard content
2. Copy transcribed text to clipboard
3. Execute native helper with --paste-and-verify
4. Helper uses AX APIs to:
   - Find focused text field
   - Insert text at cursor position
   - Verify insertion success
5. Restore original clipboard content
```

### Clipboard Management
```typescript
// src/main.ts:1114-1121
const originalClipboardText = clipboard.readText();
const payloadText = text.trimStart(); // Remove leading whitespace
clipboard.writeText(payloadText);
// ... paste operation ...
// Restore original clipboard (handled by native helper)
```

---

## State Management

### Hook State Structure
```typescript
// src/hooks/useTranscription.ts:13-23
export interface UseTranscriptionReturn {
  recording: boolean;     // Currently capturing audio
  processing: boolean;    // Sending to API / waiting for response
  ready: boolean;         // Microphone stream available
  text: string;          // Last transcription result
  error: string | null;   // Error message for user display
  level: number;         // 0..1 smoothed audio level
  peak: number;          // 0..1 fast peak level
  start: () => void;     // Begin recording
  stop: () => void;      // End recording and transcribe
}
```

### State Transitions

#### Recording Flow
```
IDLE → start() → RECORDING → stop() → PROCESSING → IDLE
  │                                        │
  └── error handling ←─────────────────────┘
```

#### State Guards
```typescript
// src/hooks/useTranscription.ts:222-227
if (recording) return;        // Prevent double-start
if (processing) return;       // Prevent start during processing
if (!streamRef.current) {     // Ensure stream available
  const ok = await openStreamForSelectedDevice();
  if (!ok) return;
}
```

### Device State Management
```typescript
// State for device management
const [selectedMicId, setSelectedMicId] = useState<string>("default");
const [ready, setReady] = useState(false);

// Auto-initialization options
const {
  autoEnumerateDevices = true,    // Discover devices on mount
  autoInitStream = true,          // Open stream automatically
  requestLabelPermissionForEnumeration = false, // Avoid permission prompt
} = options ?? {};
```

---

## Device Management

### Device Enumeration

#### Automatic Discovery
```typescript
// src/hooks/useTranscription.ts:66-99
const enumerateAndSendDevices = useCallback(async () => {
  // Optional permission request for device labels
  if (requestLabelPermissionForEnumeration) {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach((track) => track.stop());
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices
    .filter((device) => device.kind === "audioinput")
    .map((device) => ({
      id: device.deviceId,
      label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
    }));
```

#### Hot-plug Support
```typescript
// src/hooks/useTranscription.ts:108-127
navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

const handleDeviceChange = () => {
  console.log("[useTranscription] Device change detected, re-enumerating...");
  setTimeout(() => {
    enumerateAndSendDevices();
  }, 200); // Small delay for system settling
};
```

### IPC Device Communication

#### Main Process Integration
```typescript
// Device updates sent to main process for tray menu
setTimeout(() => {
  if (window.mic?.updateDevices) {
    window.mic.updateDevices(audioInputs, selectedMicId);
  }
}, 500); // Delay ensures tray is ready
```

#### Selection Changes
```typescript
// Listen for device selection from main process
const unsubscribe = window.mic.onSelectedChanged(({ id }) => {
  console.log("[useTranscription] Microphone selection changed to:", id);
  setSelectedMicId(id);
});
```

### Stream Management

#### Device-Specific Constraints
```typescript
// src/hooks/useTranscription.ts:169-173
if (selectedMicId !== "default") {
  (constraints.audio as MediaTrackConstraints).deviceId = {
    exact: selectedMicId,
  };
}
```

#### Stream Lifecycle
```typescript
// Automatic stream reinitialization on device change
useEffect(() => {
  const initializeMicrophone = async () => {
    // Stop existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setReady(false);
    }
    
    await openStreamForSelectedDevice();
  };
  
  initializeMicrophone();
}, [selectedMicId]); // Reinitialize when device changes
```

---

## Error Handling

### Error Categories

#### 1. Microphone Access Errors
```typescript
// src/hooks/useTranscription.ts:186-193
catch (err) {
  console.error("[useTranscription] Failed to open microphone stream:", err);
  setError(
    "Microphone permissions denied or selected microphone not available."
  );
  setReady(false);
  return false;
}
```

#### 2. Audio Processing Errors
```typescript
// src/hooks/useTranscription.ts:303-306
catch (err) {
  setError((err as Error).message);
  setRecording(false);
}
```

#### 3. API Communication Errors
```typescript
// src/hooks/useTranscription.ts:365-368
if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`Server error: ${errorText}`);
}
```

#### 4. Text Insertion Errors
```typescript
// src/main.ts:1127-1136
if (!fs.existsSync(helperPath)) {
  console.error(`[PasteHelper] Sonic Flow Helper binary not found at path: ${helperPath}`);
  mainWindow?.webContents.send(
    "notify",
    "Paste unavailable: binary missing. Copied to clipboard."
  );
  return { success: false, error: "Paste helper binary not found." };
}
```

### Error Recovery Strategies

#### Graceful Degradation
1. **Microphone Unavailable**: Retry with different device or show error
2. **API Failure**: Display error but maintain app functionality
3. **Text Insertion Failure**: Fall back to clipboard copy
4. **Permission Denied**: Guide user through permission setup

#### User Feedback
```typescript
// Error display in UI through state management
const [error, setError] = useState<string | null>(null);

// Notification system for non-blocking errors
mainWindow?.webContents.send("notify", "Error message here");
```

---

## Performance Optimization

### Audio Processing Optimizations

#### AudioWorklet Isolation
- **Dedicated Thread**: Audio processing isolated from main UI thread
- **Minimal Allocations**: Reuse Int16Array buffers to prevent GC pressure
- **Efficient Downsampling**: Simple decimation avoids complex filtering

#### Memory Management
```typescript
// src/hooks/useTranscription.ts:233
audioChunksRef.current = []; // Clear chunks on start

// src/hooks/useTranscription.ts:381
audioChunksRef.current = []; // Clear chunks after processing
```

#### AudioContext Lifecycle
```typescript
// src/hooks/useTranscription.ts:329-336
// Suspend AudioContext when idle to reduce CPU usage
if (audioCtxRef.current && audioCtxRef.current.state === "running") {
  try {
    await audioCtxRef.current.suspend();
  } catch (e) {
    // ignore suspend errors
  }
}
```

### Network Optimizations

#### Efficient Audio Encoding
- **16kHz Sample Rate**: Reduces file size vs 48kHz (3x smaller)
- **16-bit PCM**: Good quality/size balance for speech
- **WAV Format**: Simple format with minimal overhead

#### Request Optimization
```typescript
// Minimal API payload with optimal parameters
formData.append("model", "whisper-large-v3-turbo"); // Fastest model
formData.append("temperature", "0");                // Deterministic, faster
```

### UI Performance

#### Level Metering Throttling
```typescript
// src/hooks/useTranscription.ts:291-293
if (++levelLogCount % 10 === 0) {
  try { console.debug('[audio-level]', { /* ... */ }); } catch {}
}
```

#### State Update Batching
- React's automatic batching prevents excessive re-renders
- Audio level updates throttled to ~20Hz for smooth animation

---

## Configuration

### Audio Configuration
```typescript
// src/config/audio.ts - Centralized audio constants
export const TARGET_AUDIO_CONTEXT_RATE = 48000;
export const MICROPHONE_PREFERRED_RATE = 48000;
export const TARGET_SAMPLE_RATE = 16000;
```

### Transcription Configuration
```typescript
// src/hooks/useTranscription.ts - Hook configuration options
export interface UseTranscriptionOptions {
  autoEnumerateDevices?: boolean;                    // Default: true
  autoInitStream?: boolean;                          // Default: true
  requestLabelPermissionForEnumeration?: boolean;    // Default: false
}
```

### AudioWorklet Configuration
```javascript
// public/audioworklet-processor.js - Processing parameters
// 960 samples per chunk = 60ms at 16kHz
pcm16 = new Int16Array(960);

// Level metering parameters
_levelSamplesTarget = 1024; // ~21ms at 48kHz
```

### Level Metering Configuration
```typescript
// src/hooks/useTranscription.ts:264-266
const ATTACK = 0.85;        // Fast attack for responsiveness
const RELEASE = 0.08;       // Slow release for stability
const DB_FLOOR = -60;       // dBFS floor for normalization
```

### API Configuration
```typescript
// Whisper API parameters (src/hooks/useTranscription.ts:354-358)
const API_ENDPOINT = "https://api.sonicflow.app";
const MODEL = "whisper-large-v3-turbo";
const LANGUAGE = "en";
const RESPONSE_FORMAT = "json";
const TEMPERATURE = "0";
```

---

## Debugging and Troubleshooting

### Debug Logging

#### Console Logging Strategy
```typescript
// Structured logging throughout pipeline
console.log("[useTranscription] Found audio input devices:", audioInputs);
console.log("[useTranscription] Microphone selection changed to:", id);
console.log("[useTranscription] Opening microphone stream with constraints:", constraints);
console.debug('[audio-level]', { rms, peak, dbRms, dbPeak, smoothLevel });
```

#### IPC Debug Logging
```typescript
// src/main.ts:1690-1694
console.log(
  "[IPC] Received transcript update:",
  text.slice(0, 50) + (text.length > 50 ? "..." : ""),
);
```

### Common Issues and Solutions

#### "Microphone permissions denied"
**Cause**: Browser hasn't granted microphone access
**Solution**: 
```typescript
// Check for permission grant in browser settings
// Retry with getUserMedia() permission prompt
```

#### "Selected microphone not available"
**Cause**: Device unplugged or changed
**Solution**:
```typescript
// Device enumeration and fallback to default
if (selectedMicId !== "default") {
  // Try with exact device ID, fallback to default if fails
}
```

#### "AudioWorklet registration failed"
**Cause**: Browser doesn't support AudioWorklet or CORS issues
**Solution**: 
```typescript
// Check workletRegistry and URL resolution
const workletPath = new URL("../../public/audioworklet-processor.js", import.meta.url);
```

#### "Server error" during transcription
**Cause**: API endpoint unavailable or audio format issues
**Solution**:
```typescript
// Check WAV blob creation and network connectivity
// Validate audio chunk accumulation
```

#### "Native helper binary not found"
**Cause**: Build process didn't copy helper or wrong path
**Solution**:
```typescript
// Verify helper exists at expected path
// Check build process and packaging configuration
```

### Performance Debugging

#### Audio Processing Performance
```javascript
// Add timing to AudioWorklet processor
const startTime = performance.now();
// ... processing ...
const processingTime = performance.now() - startTime;
if (processingTime > 5) {
  this.port.postMessage({ type: 'performance-warning', processingTime });
}
```

#### Memory Usage Monitoring
```typescript
// Monitor audio chunk accumulation
console.log(`Audio chunks: ${audioChunksRef.current.length}, Total samples: ${totalLength}`);
```

#### Network Request Timing
```typescript
// Add timing around fetch requests
const startTime = performance.now();
const response = await fetch("https://api.sonicflow.app", { /* ... */ });
console.log(`Transcription request took: ${performance.now() - startTime}ms`);
```

### Testing and Validation

#### Audio Pipeline Testing
```bash
# Test audio capture without transcription
# Verify level metering and PCM chunk generation
# Check AudioWorklet registration and processing
```

#### API Integration Testing
```bash
# Test with known good audio file
# Verify FormData construction
# Check response parsing
```

#### Native Helper Testing
```bash
# Test helper binary directly
./native/bin/Sonic\ Flow\ Helper.app/Contents/MacOS/Sonic\ Flow\ Helper --paste-and-verify "test text"

# Check permissions
./native/bin/Sonic\ Flow\ Helper.app/Contents/MacOS/Sonic\ Flow\ Helper --check-permissions
```

---

## API Reference

### useTranscription Hook

#### Interface
```typescript
export interface UseTranscriptionReturn {
  // State
  recording: boolean;           // Currently recording audio
  processing: boolean;          // Awaiting transcription response
  ready: boolean;              // Microphone stream available
  text: string;                // Last transcription result
  error: string | null;        // User-displayable error message
  level: number;               // 0..1 smoothed audio level for UI
  peak: number;                // 0..1 fast peak level for accents
  
  // Actions
  start: () => void;           // Begin audio recording
  stop: () => void;            // End recording and start transcription
}

export interface UseTranscriptionOptions {
  autoEnumerateDevices?: boolean;                    // Auto-discover devices
  autoInitStream?: boolean;                          // Auto-open microphone
  requestLabelPermissionForEnumeration?: boolean;    // Request mic for labels
}
```

#### Usage
```typescript
const transcription = useTranscription({
  autoEnumerateDevices: true,     // Discover devices on mount
  autoInitStream: true,           // Open microphone stream
  requestLabelPermissionForEnumeration: false, // Avoid permission prompt
});

// Recording flow
const handleStart = () => transcription.start();
const handleStop = () => transcription.stop();

// State monitoring
if (transcription.error) {
  // Display error to user
}
if (transcription.processing) {
  // Show loading state
}
```

### AudioWorklet Processor

#### Message Types
```javascript
// PCM data messages (ArrayBuffer)
event.data instanceof ArrayBuffer // Raw PCM16 audio data

// Level metering messages (Object)
{
  type: 'level',
  rms: number,    // 0..1 RMS level
  peak: number    // 0..1 peak level
}
```

#### Configuration
```javascript
class CaptureProcessor extends AudioWorkletProcessor {
  pcm16 = new Int16Array(960);          // 60ms chunks at 16kHz
  _levelSamplesTarget = 1024;           // ~21ms level updates at 48kHz
  
  process(inputs, outputs, parameters) {
    // Downsample 48kHz → 16kHz (every 3rd sample)
    // Convert Float32 → Int16
    // Emit PCM chunks and level data
  }
}
```

### IPC Interface

#### Main Process Handlers
```typescript
// Microphone device management
"mic:update-devices"    // Send device list to main
"mic:get-selected"      // Get currently selected device
"mic:on-selection"      // Listen for device selection changes
"mic:refresh-request"   // Request device re-enumeration

// Text insertion
"insert-text-at-cursor" // Insert transcribed text at cursor

// Transcript management  
"transcript:update"     // Send transcript to main for context menu
```

#### Renderer Process Events
```typescript
window.mic = {
  updateDevices: (devices, selectedId) => void,
  onSelectedChanged: (callback) => unsubscribe,
  onRefreshRequest: (callback) => unsubscribe,
};

window.clipboard = {
  insertText: (text) => Promise<{success: boolean, error?: string}>,
};

window.transcript = {
  update: (text) => void,
};
```

### Native Helper Binary

#### Command Line Interface
```bash
# Check permissions
./Sonic\ Flow\ Helper --check-permissions
# Output: "ax-granted" and/or "im-granted"

# Paste and verify text
./Sonic\ Flow\ Helper --paste-and-verify "text to insert"
# Returns: success/failure status with verification
```

#### Integration
```typescript
// Spawn helper process
const proc = spawnHelper(helperPath, ["--paste-and-verify", text], false);

// Parse output for success/failure
let stdoutBuffer = "";
proc.stdout.on("data", (data) => {
  stdoutBuffer += data.toString();
});

proc.on("close", (code) => {
  const success = code === 0 && stdoutBuffer.includes("SUCCESS");
});
```

---

## Recent Updates and Improvements

### Performance Enhancements (2024)
1. **AudioWorklet Optimization**: Reduced memory allocations and improved downsample efficiency
2. **Level Metering**: Enhanced responsiveness with asymmetric attack/release smoothing
3. **Chunk Processing**: Optimized 60ms chunk size for latency/quality balance
4. **Stream Management**: Improved device switching and stream lifecycle handling

### Reliability Improvements
1. **Error Recovery**: Enhanced fallback strategies for device and API failures
2. **Permission Handling**: Better integration with native helper for accessibility
3. **State Synchronization**: Improved IPC communication and state management
4. **Memory Management**: Proper cleanup of audio resources and references

### API Integration Updates
1. **Whisper v3 Turbo**: Upgraded to latest model for improved speed and accuracy
2. **Request Optimization**: Streamlined payload and parameters for faster processing
3. **Error Handling**: Enhanced API error parsing and user feedback
4. **Response Processing**: Improved text extraction and insertion flow

### Development Experience
1. **Debug Logging**: Comprehensive logging throughout the pipeline
2. **Type Safety**: Full TypeScript coverage with proper interfaces
3. **Testing Support**: Better testing hooks and debugging utilities
4. **Documentation**: Comprehensive inline documentation and examples

This transcription system provides a robust, high-performance foundation for real-time speech-to-text functionality with native macOS integration and professional-grade audio processing.