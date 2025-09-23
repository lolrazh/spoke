# Buffer Overflow Fix

## User Intention
Fix random "buffered audio limit reached" errors that occurred even when not actively dictating.

## Problem Analysis
The issue was caused by the AudioWorkletProcessor continuously processing audio even when the user was not dictating. When WebSocket connection issues occurred (network problems, temporary disconnections, or slow connections), audio frames would accumulate in the client-side queue until hitting the 20MB limit, triggering the error.

## Root Causes
1. **AudioWorklet runs continuously**: The AudioWorkletProcessor processes audio at all times once started, regardless of dictation state
2. **No connection health monitoring**: No mechanism to detect when WebSocket connections become unhealthy
3. **High buffer threshold**: 20MB limit was too high, allowing problems to persist before detection
4. **No pause/resume mechanism**: No way to temporarily stop audio processing when connections are unhealthy

## Solution Implemented

### 1. AudioWorklet Pause/Resume Mechanism
- Added `pauseAudioWorklet()` and `resumeAudioWorklet()` functions to control audio processing
- Modified the AudioWorkletProcessor to support pause/resume messages
- Audio processing stops when paused, preventing buffer buildup

### 2. WebSocket Health Monitoring
- Implemented `startWebSocketHealthCheck()` with 2-second intervals
- Monitors connection activity and buffer levels
- Automatically pauses audio worklet when connection becomes unhealthy
- Resumes when connection recovers and buffer drops to safe levels

### 3. Granular Buffer Management
- Reduced client buffer limit from 20MB to 2MB for faster detection
- Added warning (1MB) and critical (1.5MB) thresholds
- Progressive response: warn → pause worklet → emergency stop
- Better backpressure handling prevents runaway buffer growth

### 4. Smart Recovery
- Health monitor automatically attempts reconnection when issues detected
- Resume audio processing only when both connection is healthy AND buffer is low
- Prevents thrashing between pause/resume states

## Key Changes

### Files Modified
1. **src/hooks/useTranscription.ts**
   - Added pause/resume audio worklet functionality
   - Implemented WebSocket health monitoring
   - Reduced buffer limits and added granular thresholds
   - Enhanced error handling and recovery

2. **public/worklets/pcm16-downsampler.worklet.js**
   - Added pause state tracking
   - Modified process() method to skip processing when paused
   - Added pause/resume message handlers

### Behavior Changes
- **Before**: Audio processed continuously → buffer overflow → hard stop with error
- **After**: Audio pauses when unhealthy → auto-recovery → seamless resume

## Testing Recommendations
1. Test with poor network conditions to verify early detection
2. Verify audio worklet pauses during connection issues
3. Confirm automatic recovery when connection improves
4. Check that normal dictation flow is unaffected
5. Monitor buffer usage in various scenarios

## Files Modified
- `src/hooks/useTranscription.ts` - Main transcription logic with health monitoring
- `public/worklets/pcm16-downsampler.worklet.js` - Audio worklet pause/resume support

## Future Improvements
- Add buffer usage metrics to UI for transparency
- Consider adaptive buffer sizing based on network conditions
- Add user preferences for buffer sensitivity levels

