# Sonic Flow Transcription Pipeline

A comprehensive real-time audio transcription system built on Web Audio API, Cloudflare Workers AI, and optimized for push-to-talk dictation with sub-200ms latency.

## Table of Contents
1. [Overview & Architecture](#overview--architecture)
2. [Audio Capture System](#audio-capture-system)
3. [Real-Time Processing](#real-time-processing)
4. [Device Management](#device-management)
5. [Cloud Transcription](#cloud-transcription)
6. [State Management](#state-management)
7. [Audio Feedback System](#audio-feedback-system)
8. [Performance Optimization](#performance-optimization)
9. [Error Handling & Recovery](#error-handling--recovery)
10. [Implementation Guide](#implementation-guide)

---

## Overview & Architecture

### What is the Transcription Pipeline?

Think of the transcription pipeline like a **smart listening assistant** that:
- **Listens** to your microphone when you hold down a key
- **Cleans up** the audio to make it crystal clear
- **Sends** the audio to a super-smart AI brain in the cloud
- **Gets back** perfectly typed text
- **Inserts** that text wherever you were typing

### High-Level Flow

```
🎙️ Microphone → 🔧 Audio Processing → ☁️ Cloud AI → 📝 Text Insertion
```

The entire process is designed to feel instantaneous, taking less than 200 milliseconds from when you stop talking to when text appears on your screen.

### Core Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Microphone    │    │   Web Audio API  │    │   MediaRecorder │
│   Selection &   │───▶│   Real-time      │───▶│   Opus Encoding │
│   Permissions   │    │   Processing     │    │   & Upload      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                       │
         ▼                        ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Device        │    │   AudioContext   │    │   Cloudflare    │
│   Enumeration   │    │   48kHz → 16kHz  │    │   Workers AI    │
│   & Selection   │    │   Downsampling   │    │   Whisper v3    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                    ┌──────────────────┐    ┌─────────────────┐
                    │   AudioWorklet   │    │   Text Output   │
                    │   PCM Processing │    │   & Insertion   │
                    └──────────────────┘    └─────────────────┘
```

### Key Components

- **useTranscription Hook** (`src/hooks/useTranscription.ts`) - Main transcription logic and state management
- **AudioWorklet Processor** (`public/audioworklet-processor.js`) - Real-time audio processing
- **Worker Endpoint** (`worker/src/endpoints/transcribe.ts`) - Cloud transcription service
- **Audio Configuration** (`src/config/audio.ts`) - Centralized audio constants
- **Audio Feedback** (`src/utils/audioFeedback.ts`) - User feedback sounds

---

## Audio Capture System

### How Audio Capture Works (ELI5)

Imagine your computer's microphone is like a **digital ear**. When you speak, it "hears" thousands of tiny sound measurements every second (48,000 per second!). The capture system:

1. **Asks permission** to use your microphone
2. **Finds all available** microphones on your system
3. **Connects to your chosen** microphone
4. **Starts listening** when you press the hotkey
5. **Stops listening** when you release the hotkey

### Device Discovery and Management

The system automatically discovers all your audio input devices:

#### Automatic Device Enumeration
- **Scans** for all microphones when the app starts
- **Updates** the list when you plug/unplug devices
- **Remembers** your preferred microphone choice
- **Sends** device info to the main process for the system tray menu

#### Smart Permission Handling
- **Avoids** requesting microphone permission until you actually start dictating
- **Only asks** for device labels when explicitly needed
- **Immediately releases** temporary streams to prevent persistent recording indicators
- **Gracefully handles** permission denials with helpful error messages

### Microphone Stream Initialization

#### Stream Configuration
The system uses optimized audio constraints:
- **Sample Rate**: 48,000 Hz (matches most hardware)
- **Channels**: 1 (mono - perfect for speech)
- **Echo Cancellation**: Disabled (preserves speech quality)
- **Noise Suppression**: Disabled (lets AI handle it better)

#### Device Selection
- **Default Device**: Uses system default if none specified
- **Specific Device**: Targets exact microphone by device ID
- **Auto-Switching**: Handles device changes gracefully
- **Fallback**: Falls back to system default if selected device unavailable

### Recording State Management

The recording system uses a simple but robust state machine:

#### States
- **Ready**: Microphone connected, waiting for input
- **Recording**: Actively capturing audio
- **Processing**: Sending audio to AI and waiting for response
- **Error**: Something went wrong, showing user-friendly message

#### State Transitions
- **Idle → Recording**: User presses hotkey, starts capture
- **Recording → Processing**: User releases hotkey, sends to AI
- **Processing → Idle**: AI responds, text inserted
- **Any → Error**: Problem occurs, shows error message

---

## Real-Time Processing

### Audio Processing Pipeline (ELI5)

Your microphone captures sound at **48,000 samples per second**, but the AI brain works best with **16,000 samples per second**. Think of this like taking a 4K video and converting it to 1080p - we need to make it smaller while keeping the important details.

### AudioContext Setup

#### Dual-Rate Architecture
The system runs two audio contexts simultaneously:
- **Capture Context**: 48kHz for high-quality microphone input
- **Processing Context**: 16kHz for AI-optimized output

#### Real-Time Downsampling
- **Creates** a 16kHz AudioContext for immediate downsampling
- **Connects** microphone source to destination stream
- **Maintains** audio quality while reducing file size
- **Enables** real-time processing without post-processing delays

### MediaRecorder Integration

#### Optimized Recording Settings
- **Format**: WebM with Opus codec (excellent compression)
- **Bitrate**: 16,000 bps (optimized for speech)
- **Collection**: 100ms chunks for responsive processing
- **Quality**: Preserves speech clarity while minimizing file size

#### Chunk Management
- **Collects** audio data every 100 milliseconds
- **Stores** chunks in memory during recording
- **Combines** all chunks when recording stops
- **Sends** single blob to transcription service

### AudioWorklet Processing

The AudioWorklet processor handles the most performance-critical audio operations:

#### Real-Time Decimation
- **Processes** 48kHz input samples
- **Takes** every 3rd sample (48kHz ÷ 3 = 16kHz)
- **Converts** Float32 samples to 16-bit integers
- **Buffers** 960 samples per chunk (60ms at 16kHz)

#### Sample Format Conversion
- **Clamps** samples to prevent audio clipping
- **Converts** floating-point to signed 16-bit integers
- **Handles** both positive and negative audio values
- **Maintains** audio fidelity during conversion

#### Chunk Streaming
- **Fills** 960-sample buffers efficiently
- **Sends** completed buffers to main thread
- **Flushes** partial buffers for short recordings
- **Maintains** consistent 60ms chunk timing

---

## Device Management

### Device Discovery Flow

The device management system handles the complexity of audio hardware:

#### Automatic Enumeration
```
App Start → Enumerate Devices → Send to Main Process → Update Tray Menu
     ↓              ↓                    ↓                     ↓
   Ready    →  Device List    →    IPC Message    →    User Selection
```

#### Device Change Handling
- **Listens** for device plug/unplug events
- **Re-enumerates** devices after changes
- **Updates** main process with new device list
- **Handles** disappearing selected devices gracefully

### Device Selection Synchronization

#### Two-Way Communication
- **Renderer to Main**: Reports available devices
- **Main to Renderer**: Reports user's device selection
- **Automatic Updates**: Changes propagate immediately
- **Persistent Memory**: Remembers chosen device across restarts

#### Selection Logic
- **Default Behavior**: Uses system default microphone
- **Explicit Selection**: Targets specific device by ID
- **Fallback Strategy**: Reverts to default if selected device unavailable
- **Error Recovery**: Provides clear feedback when devices fail

### Permission Management

#### Progressive Permission Requests
- **Initial Setup**: Enumerates without labels (no permission needed)
- **On-Demand**: Requests mic access only when starting transcription
- **Label Access**: Gets device names only when explicitly needed
- **Immediate Cleanup**: Stops temporary streams to avoid persistent recording

#### Permission States
- **Unknown**: Haven't asked yet
- **Granted**: User allowed access
- **Denied**: User blocked access
- **Error**: Technical problem occurred

---

## Cloud Transcription

### Cloudflare Workers AI Service

The transcription happens on Cloudflare's global edge network using state-of-the-art AI:

#### Whisper Large v3 Turbo
- **Model**: OpenAI's latest and fastest speech-to-text AI
- **Language**: Optimized for English (configurable)
- **Speed**: Sub-second processing for most audio clips
- **Accuracy**: Industry-leading transcription quality

#### Edge Computing Benefits
- **Global**: Processes at the closest data center to you
- **Fast**: Minimal network latency
- **Reliable**: Built-in redundancy and failover
- **Scalable**: Handles traffic spikes automatically

### API Communication

#### Request Format
The system sends multipart form data:
- **file**: WebM/Opus audio blob
- **language**: "en" (English, configurable)
- **initial_prompt**: Context hints for better accuracy
- **task**: "transcribe" (vs. translate)
- **vad_filter**: Voice activity detection for cleaner results

#### Response Processing
- **text**: Final transcript ready for insertion
- **vtt**: WebVTT captions (not currently used)
- **segments**: Timestamped word segments (not currently used)
- **info**: Metadata about transcription process

### Quality Optimization

#### Context Hints
The system provides vocabulary hints to improve accuracy:
- **Names**: "Sandheep Rajkumar, Sonic Flow"
- **Tech Terms**: "Groq, Supabase, Gemini Flash Lite"
- **Custom**: Expandable for user-specific vocabulary

#### Audio Preprocessing
- **Voice Activity Detection**: Removes silence and noise
- **Format Optimization**: Opus codec ideal for speech
- **Compression**: Reduces upload time without quality loss

---

## State Management

### Hook-Based Architecture

The transcription system uses React hooks for clean state management:

#### State Variables
- **recording**: Currently capturing audio
- **processing**: Sending to AI and waiting for response
- **ready**: Microphone connected and available
- **text**: Latest transcription result
- **error**: Current error message (if any)

#### Control Methods
- **start()**: Begin recording audio
- **stop()**: End recording and send to AI
- **cancel()**: Abort current operation
- **Auto-management**: Handles device changes and errors

### Configuration Options

#### Hook Configuration
- **autoEnumerateDevices**: Automatically scan for microphones
- **autoInitStream**: Pre-connect to selected microphone
- **requestLabelPermissionForEnumeration**: Ask for device names upfront

#### Flexible Behavior
- **Development**: More permissive for testing
- **Production**: Conservative for user privacy
- **Customizable**: Apps can adjust behavior as needed

### Error State Handling

#### User-Friendly Errors
- **"Microphone permissions denied"**: Clear next steps
- **"Selected microphone not available"**: Suggests alternatives
- **"Network error"**: Explains temporary nature
- **"Processing failed"**: Offers retry option

#### Automatic Recovery
- **Device switching**: Handles unplugged microphones
- **Permission restoration**: Recovers from denied permissions
- **Network resilience**: Retries failed requests
- **State cleanup**: Always returns to consistent state

---

## Audio Feedback System

### Why Audio Feedback Matters (ELI5)

When you press a button on your phone, it makes a little click sound so you know you pressed it. Sonic Flow does the same thing - when you start or stop recording, it plays a subtle sound so you know the app heard you.

### Feedback Sounds

#### Toggle On Sound
- **Timing**: Plays 25ms after recording starts
- **Purpose**: Confirms recording has begun
- **Volume**: 30% (subtle but noticeable)
- **Preloading**: Ready instantly with no delay

#### Toggle Off Sound
- **Timing**: Plays 100ms after recording stops
- **Purpose**: Confirms recording ended and processing started
- **Volume**: 20% (slightly quieter)
- **Feedback**: Signals that AI processing has begun

### Smart Playback

#### User Preferences
- **Respects** system sound settings
- **Honors** user's "Play Sounds" preference
- **Stores** preference in localStorage
- **Defaults** to enabled for best experience

#### Performance Optimization
- **Preloads** audio files to eliminate delays
- **Prevents** overlapping sounds from rapid keypresses
- **Handles** playback failures gracefully
- **Uses** efficient HTMLAudioElement API

### Sound File Management

#### Asset Integration
- **Vite Integration**: Sounds imported as URL assets
- **Format**: WAV files for immediate playback
- **Size**: Optimized for quick loading
- **Quality**: Clear, professional feedback tones

---

## Performance Optimization

### Latency Reduction Strategies

#### Audio Path Optimization
- **Direct Streaming**: AudioWorklet processes audio in real-time
- **Minimal Buffering**: 60ms chunks for responsive feedback
- **Efficient Encoding**: Opus codec optimized for speech
- **Pre-downsampling**: 16kHz processing reduces upload time

#### Network Optimization
- **Edge Computing**: Cloudflare's global network
- **Request Compression**: Efficient form data encoding
- **Parallel Processing**: Audio encoding while user is speaking
- **Smart Timeouts**: Appropriate timeouts for different operations

### Memory Management

#### Stream Cleanup
- **Immediate Cleanup**: Stops tracks when recording ends
- **Context Closure**: Properly closes AudioContext instances
- **Reference Clearing**: Nullifies object references
- **Memory Monitoring**: Prevents accumulation over time

#### Buffer Management
- **Fixed-Size Buffers**: 960-sample chunks prevent growth
- **Automatic Flushing**: Clears buffers after processing
- **Efficient Arrays**: Uses typed arrays for performance
- **Garbage Collection**: Allows prompt memory reclamation

### CPU Optimization

#### AudioWorklet Benefits
- **Separate Thread**: Doesn't block main UI thread
- **Real-Time Priority**: OS gives high scheduling priority
- **Efficient Processing**: Minimal per-sample overhead
- **Hardware Acceleration**: Leverages audio hardware capabilities

#### Efficient State Updates
- **Batched Updates**: Reduces React re-renders
- **Memoized Callbacks**: Prevents unnecessary function recreations
- **Conditional Processing**: Only processes when needed
- **Cleanup Scheduling**: Defers non-critical cleanup

---

## Error Handling & Recovery

### Robust Error Handling Strategy

#### Graceful Degradation
- **Device Failures**: Falls back to system default
- **Permission Denials**: Shows clear recovery instructions
- **Network Issues**: Provides retry options
- **Processing Errors**: Maintains app stability

#### User Communication
- **Clear Messages**: Explains problems in plain language
- **Action Items**: Tells users exactly what to do next
- **Status Updates**: Shows progress during recovery
- **Success Confirmation**: Confirms when issues are resolved

### Common Error Scenarios

#### Microphone Issues
- **Not Available**: Selected device unplugged or in use
- **Permission Denied**: User blocked microphone access
- **Hardware Failure**: Device malfunction or driver issues
- **Format Unsupported**: Unusual device configurations

#### Network Problems
- **Connection Failed**: Internet connection issues
- **Server Error**: Cloudflare Workers service problems
- **Timeout**: Request took too long to complete
- **Rate Limiting**: Too many requests in short time

#### Processing Failures
- **Audio Format**: Unsupported or corrupted audio
- **File Size**: Audio too large or too small
- **AI Service**: Temporary service unavailability
- **Response Parsing**: Malformed server response

### Recovery Mechanisms

#### Automatic Recovery
- **Device Re-scanning**: Detects when devices return
- **Connection Retry**: Attempts reconnection after delays
- **State Reset**: Returns to known good state
- **Memory Cleanup**: Prevents resource leaks during errors

#### User-Initiated Recovery
- **Manual Refresh**: Device enumeration button
- **Permission Re-request**: Guides through permission flow
- **Device Selection**: Easy switching to working device
- **Settings Reset**: Factory defaults option

---

## Implementation Guide

### Getting Started with Transcription

#### Basic Usage
The transcription system is designed to "just work" with minimal setup:

- **Install Dependencies**: Web Audio API support (built into modern browsers)
- **Initialize Hook**: Import and use `useTranscription`
- **Handle State**: Monitor `recording`, `processing`, and `ready` states
- **Manage Text**: Display and use the `text` result

#### Hook Integration
```typescript
const {
  recording,    // Currently capturing audio
  processing,   // Sending to AI
  ready,       // Microphone available
  text,        // Latest transcription
  error,       // Any error message
  start,       // Begin recording
  stop,        // End recording and transcribe
  cancel       // Abort operation
} = useTranscription();
```

### Configuration Options

#### Device Management
- **Auto-enumerate**: Automatically find available microphones
- **Auto-connect**: Pre-initialize microphone stream
- **Permission Strategy**: When to request microphone access
- **Label Access**: Whether to get device names immediately

#### Audio Settings
- **Sample Rates**: 48kHz capture, 16kHz processing
- **Quality Settings**: Bitrate and compression preferences
- **Buffer Sizes**: Chunk timing and memory usage
- **Format Selection**: Codec and container choices

### Integration Patterns

#### State-Driven UI
```typescript
// Recording indicator
{recording && <RecordingIndicator />}

// Processing spinner
{processing && <ProcessingSpinner />}

// Error display
{error && <ErrorMessage message={error} />}

// Result text
{text && <TranscriptionResult text={text} />}
```

#### Event Handling
```typescript
// Start recording on hotkey press
useEffect(() => {
  const handleKeyDown = (e) => {
    if (e.key === 'F18' && !recording) {
      start();
    }
  };
  
  const handleKeyUp = (e) => {
    if (e.key === 'F18' && recording) {
      stop();
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };
}, [recording, start, stop]);
```

### Best Practices

#### Performance
- **Pre-initialize**: Connect to microphone early for instant recording
- **Efficient Cleanup**: Always clean up streams and contexts
- **Memory Monitoring**: Watch for accumulation over time
- **Error Boundaries**: Wrap transcription UI in error boundaries

#### User Experience
- **Clear Feedback**: Always show recording and processing states
- **Graceful Errors**: Provide actionable error messages
- **Device Management**: Handle device changes transparently
- **Accessibility**: Support keyboard navigation and screen readers

#### Development
- **Environment Detection**: Different behavior for dev vs. production
- **Debug Logging**: Comprehensive logging for troubleshooting
- **Permission Testing**: Test various permission scenarios
- **Device Testing**: Test with different microphone types

### Troubleshooting

#### Common Issues
- **No Microphone Access**: Check browser permissions
- **Poor Quality**: Verify microphone settings and position
- **Slow Transcription**: Check network connection
- **Missing Text**: Verify audio is being captured

#### Debug Information
- **Browser Console**: Detailed logging in development mode
- **Network Tab**: Monitor API requests and responses
- **Audio Analysis**: Visualize captured audio data
- **State Inspection**: Monitor React state changes

#### Development Tools
- **Mock Permissions**: Test permission flows
- **Simulated Errors**: Test error handling
- **Audio Visualization**: Debug audio capture issues
- **Network Simulation**: Test offline scenarios

---

## Advanced Configuration

### Custom Vocabulary

You can improve transcription accuracy by providing context-specific vocabulary:

#### Industry Terms
- **Tech**: Framework names, API terms, programming languages
- **Medical**: Drug names, procedure terms, anatomical references  
- **Legal**: Case names, legal terminology, court procedures
- **Business**: Company names, product names, industry jargon

#### Personal Names
- **Colleagues**: First and last names of frequent contacts
- **Clients**: Customer and client names
- **Organizations**: Company names, department names
- **Locations**: Office locations, city names, venue names

### Environment-Specific Behavior

#### Development Mode
- **Permissive Settings**: More debugging, less privacy protection
- **Mock Devices**: Simulated hardware for testing
- **Extended Timeouts**: Longer waits for debugging
- **Verbose Logging**: Detailed console output

#### Production Mode
- **Privacy First**: Minimal permission requests
- **Optimized Performance**: Efficient resource usage
- **Error Recovery**: Robust handling of edge cases
- **User-Friendly**: Clear, helpful messaging

This transcription pipeline provides a foundation for high-quality, real-time speech-to-text functionality that can be extended and customized for various use cases while maintaining excellent performance and user experience.