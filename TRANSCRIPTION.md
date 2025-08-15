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

Sonic Flow implements a **real-time audio transcription pipeline** that captures microphone input, encodes it using Opus WebM format via MediaRecorder, sends it to Whisper ASR, and automatically inserts the transcribed text at the cursor position. The system is optimized for low-latency push-to-talk dictation with high accuracy and efficient compression.

### Key Features
- **Opus WebM Encoding** - Efficient audio compression via MediaRecorder with 16kHz AudioContext
- **Whisper Large v3 Turbo** - State-of-the-art ASR model via api.sonicflow.app
- **Native Text Insertion** - Direct cursor positioning via accessibility APIs
- **Optimized Audio Processing** - Browser-native encoding with minimal CPU overhead
- **Device Management** - Hot-pluggable microphone selection and enumeration
- **Graceful Error Handling** - Comprehensive fallbacks and user feedback

### Core Components
- **useTranscription Hook** (`src/hooks/useTranscription.ts`) - Main transcription orchestrator
- **MediaRecorder API** - Browser-native audio recording with Opus WebM encoding
- **AudioContext** - 16kHz sample rate optimization for Whisper compatibility
- **Native Helper** - macOS accessibility integration for text insertion
- **Audio Feedback System** (`src/utils/audioFeedback.ts`) - Start/stop sound cues

---

## Architecture

### System Flow Diagram
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Microphone    │───▶│   AudioContext   │───▶│  MediaRecorder  │
│   (48kHz)       │    │   (16kHz)        │    │  (Opus WebM)    │
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
- **Renderer Process** - UI state, MediaRecorder-based audio recording, transcription requests
- **MediaRecorder API** - Browser-native audio encoding with Opus compression
- **Native Helper Binary** - macOS accessibility integration and text insertion

---

## Audio Processing Pipeline

### 1. Microphone Capture

#### Configuration
```typescript
// src/config/audio.ts
export const MICROPHONE_PREFERRED_RATE = 48000; // Microphone capture rate
```

#### MediaStream Setup
```typescript
// src/hooks/useTranscription.ts:148-155
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

### 2. AudioContext Downsampling

#### 16kHz AudioContext
```typescript
// src/hooks/useTranscription.ts:225-228
audioContextRef.current = new AudioContext({ sampleRate: 16000 });
const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
const dest = audioContextRef.current.createMediaStreamDestination();
source.connect(dest);
```

**Benefits:**
- **Browser-Native Downsampling**: Leverages optimized browser resampling algorithms
- **16kHz Output**: Matches Whisper model requirements without custom processing
- **Minimal CPU**: Eliminates custom AudioWorklet processing overhead

### 3. Opus WebM Encoding

#### MediaRecorder Configuration
```typescript
// src/hooks/useTranscription.ts:231-234
mediaRecorderRef.current = new MediaRecorder(dest.stream, {
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 24000, // Optimized for speech
});
```

#### Opus Compression Benefits
- **Superior Compression**: ~3-5x smaller files than PCM WAV
- **Speech Optimized**: Opus codec designed for voice communication
- **Browser Native**: No custom encoding implementation required
- **Low Latency**: Real-time encoding during recording

#### Data Collection
```typescript
// src/hooks/useTranscription.ts:236-242
mediaRecorderRef.current.ondataavailable = (event) => {
  if (event.data.size > 0) {
    audioChunksRef.current.push(event.data);
  }
};

mediaRecorderRef.current.start(100); // Collect data every 100ms
```

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
// FormData payload structure - src/hooks/useTranscription.ts:290-295
const audioBlob = new Blob(audioChunksRef.current, { 
  type: 'audio/webm;codecs=opus' 
});

formData.append("file", audioBlob, "audio.webm");
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
// src/hooks/useTranscription.ts:6-14
export interface UseTranscriptionReturn {
  recording: boolean;     // Currently capturing audio
  processing: boolean;    // Sending to API / waiting for response
  ready: boolean;         // Microphone stream available
  text: string;          // Last transcription result
  error: string | null;   // Error message for user display
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
// src/hooks/useTranscription.ts:210-215
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

#### MediaRecorder Efficiency
- **Browser-Native Encoding**: Leverages optimized browser codecs for Opus compression
- **Hardware Acceleration**: MediaRecorder can utilize hardware encoding when available
- **Minimal CPU Overhead**: Eliminates custom AudioWorklet processing and manual downsampling

#### Memory Management
```typescript
// src/hooks/useTranscription.ts:221
audioChunksRef.current = []; // Clear chunks on start

// src/hooks/useTranscription.ts:318
audioChunksRef.current = []; // Clear chunks after processing
```

#### AudioContext Lifecycle
```typescript
// src/hooks/useTranscription.ts:271-274
// Close AudioContext after recording to free resources
if (audioContextRef.current) {
  audioContextRef.current.close();
  audioContextRef.current = null;
}
```

#### Stream Management
```typescript
// src/hooks/useTranscription.ts:277-281
// Stop stream completely to turn off macOS mic indicator
if (streamRef.current) {
  streamRef.current.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
  setReady(false);
}
```

### Network Optimizations

#### Efficient Audio Encoding
- **Opus WebM**: Modern codec with superior compression vs PCM (3-5x smaller files)
- **16kHz Sample Rate**: Optimal for speech recognition while minimizing bandwidth
- **24kbps Bitrate**: Speech-optimized bitrate providing excellent quality/size ratio
- **Real-time Encoding**: Opus compression happens during recording, no post-processing delay

#### Request Optimization
```typescript
// Minimal API payload with optimal parameters
formData.append("model", "whisper-large-v3-turbo"); // Fastest model
formData.append("temperature", "0");                // Deterministic, faster
```

### UI Performance

#### Simplified State Management
- Removed audio level metering to eliminate constant state updates
- MediaRecorder handles encoding asynchronously, reducing main thread load
- React's automatic batching prevents excessive re-renders during device changes

---

## Configuration

### Audio Configuration
```typescript
// src/config/audio.ts - Centralized audio constants
export const MICROPHONE_PREFERRED_RATE = 48000;
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

### MediaRecorder Configuration
```typescript
// src/hooks/useTranscription.ts - MediaRecorder setup
{
  mimeType: 'audio/webm;codecs=opus',    // Opus codec in WebM container
  audioBitsPerSecond: 24000,             // 24kbps optimized for speech
}

// Data collection interval
mediaRecorderRef.current.start(100);    // Collect chunks every 100ms
```


### API Configuration
```typescript
// Whisper API parameters (src/hooks/useTranscription.ts:291-295)
formData.append("file", audioBlob, "audio.webm");
formData.append("model", "whisper-large-v3-turbo");
formData.append("language", "en");
formData.append("response_format", "json");
formData.append("temperature", "0");

const API_ENDPOINT = "https://api.sonicflow.app";
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

#### "MediaRecorder not supported"
**Cause**: Browser doesn't support MediaRecorder or Opus codec
**Solution**: 
```typescript
// Check MediaRecorder and codec support
if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
  // Fallback to alternative format or show error
}
```

#### "Server error" during transcription
**Cause**: API endpoint unavailable or audio format issues
**Solution**:
```typescript
// Check Opus WebM blob creation and network connectivity
// Validate MediaRecorder chunk accumulation
console.log(`Opus file size: ${(audioBlob.size / 1024).toFixed(2)} KB`);
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
```typescript
// Monitor MediaRecorder encoding performance
mediaRecorderRef.current.onstart = () => {
  console.log('[PERF] MediaRecorder encoding started');
};

mediaRecorderRef.current.ondataavailable = (event) => {
  const chunkSize = event.data.size;
  console.log(`[PERF] Opus chunk: ${(chunkSize / 1024).toFixed(2)} KB`);
};
```

#### Memory Usage Monitoring
```typescript
// Monitor Opus blob chunk accumulation
const totalSize = audioChunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0);
console.log(`Opus chunks: ${audioChunksRef.current.length}, Total size: ${(totalSize / 1024).toFixed(2)} KB`);
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
# Verify MediaRecorder and Opus encoding
# Check AudioContext downsampling and stream routing
```

#### API Integration Testing
```bash
# Test with known good Opus WebM file
# Verify FormData construction with audio.webm
# Check response parsing and text extraction
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

### MediaRecorder API Integration

#### Opus WebM Configuration
```typescript
// MediaRecorder setup for optimal speech encoding
{
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 24000,
}
```

#### Event Handling
```typescript
mediaRecorderRef.current.ondataavailable = (event) => {
  if (event.data.size > 0) {
    audioChunksRef.current.push(event.data);
  }
};

mediaRecorderRef.current.onstop = () => {
  // Combine all chunks into final Opus blob
  const audioBlob = new Blob(audioChunksRef.current, { 
    type: 'audio/webm;codecs=opus' 
  });
};
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

### Major Architecture Migration (2024)
1. **Opus WebM Encoding**: Migrated from custom AudioWorklet + WAV to MediaRecorder with Opus compression
2. **Simplified Pipeline**: Eliminated custom PCM processing in favor of browser-native encoding
3. **Performance Gains**: 3-5x smaller file sizes with superior speech quality
4. **Reduced Complexity**: Removed custom downsampling, level metering, and manual format conversion

### Performance Enhancements
1. **MediaRecorder Efficiency**: Leverages hardware-accelerated Opus encoding when available
2. **Memory Optimization**: Eliminated custom audio buffers and manual PCM processing
3. **CPU Reduction**: Browser-native encoding reduces main thread processing overhead
4. **Stream Management**: Improved device switching and complete stream cleanup

### Reliability Improvements
1. **Error Recovery**: Enhanced fallback strategies for device and API failures
2. **Permission Handling**: Better integration with native helper for accessibility
3. **State Synchronization**: Improved IPC communication and state management
4. **Browser Compatibility**: MediaRecorder provides better cross-browser support

### API Integration Updates
1. **Whisper v3 Turbo**: Continued use of latest model with new Opus WebM format
2. **Compression Benefits**: Significantly reduced bandwidth usage and upload times
3. **Error Handling**: Enhanced API error parsing and user feedback
4. **Response Processing**: Maintained efficient text extraction and insertion flow

### Development Experience
1. **Simplified Codebase**: Removed complex AudioWorklet processor and WAV utilities
2. **Type Safety**: Maintained full TypeScript coverage with updated interfaces
3. **Testing Support**: Streamlined testing without custom audio processing components
4. **Documentation**: Updated comprehensive documentation reflecting new architecture

This transcription system provides a robust, high-performance foundation for real-time speech-to-text functionality with native macOS integration and professional-grade audio processing.