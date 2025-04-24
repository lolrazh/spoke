import { useState, useEffect, useRef, useCallback } from 'react';

// Define the return type for the simplified hook
interface UseSimpleWhisperRecorderReturn {
  isRecording: boolean;
  startRecording: () => Promise<void>; // Make async to handle permissions
  stopRecording: () => Promise<Blob | null>; // Returns the final Blob or null
  error: string | null;
}

// Simplified recorder hook
export function useWhisperRecorder(): UseSimpleWhisperRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Function to request microphone permission and setup stream
  const setupStream = useCallback(async () => {
    if (streamRef.current) return streamRef.current; // Already have stream

    try {
      console.log('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          // Basic audio constraints are usually sufficient
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      streamRef.current = stream;
      console.log('Microphone access granted.');
      setError(null); // Clear previous errors
      return stream;
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Microphone access denied or unavailable. Please check permissions.');
      streamRef.current = null;
      return null;
    }
  }, []);

  // Function to start recording
  const startRecording = useCallback(async () => {
    if (isRecording) {
      console.warn('Already recording.');
      return;
    }

    // Ensure stream is ready
    const stream = await setupStream();
    if (!stream) {
      // Error state already set by setupStream
      return; 
    }

    // Clear previous chunks
    audioChunksRef.current = []; 

    try {
      // Determine a supported MIME type
      const mimeTypes = [
        'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'
      ];
      const selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
      console.log(`Creating MediaRecorder with MIME type: ${selectedMimeType}`);

      const recorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
      recorderRef.current = recorder;

      // Event listener for collecting audio data
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          // console.log(`Collected audio chunk: ${event.data.size} bytes`); // Debug
        }
      };

      // Event listener for errors during recording
      recorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        setError('An error occurred during recording.');
        // Attempt to clean up even on error
        stopRecordingInternal(true); 
      };
      
      recorder.start();
      setIsRecording(true);
      setError(null); // Clear previous errors
      console.log('Recording started.');

    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('Failed to initialize recorder.');
      setIsRecording(false);
      // Clean up stream if recorder failed
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, [isRecording, setupStream]);

  // Internal function to handle stopping logic
  const stopRecordingInternal = useCallback((isErrorCleanup = false) => {
    if (!recorderRef.current) return null;

    return new Promise<Blob | null>((resolve) => {
      // Define the stop handler
      const handleStop = () => {
        // Clean up listeners immediately
        if (recorderRef.current) {
          recorderRef.current.ondataavailable = null;
          recorderRef.current.onerror = null;
          recorderRef.current.onstop = null;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: recorderRef.current?.mimeType || 'audio/webm' });
        audioChunksRef.current = []; // Clear chunks

        console.log(`Recording stopped. Final Blob size: ${audioBlob.size} bytes`);
        
        // Stop media stream tracks only if not called during error cleanup where stream might be needed
        if (!isErrorCleanup && streamRef.current) {
             console.log('Stopping media stream tracks.');
             streamRef.current.getTracks().forEach(track => track.stop());
             streamRef.current = null; // Release stream reference
        }
        
        recorderRef.current = null; // Release recorder reference
        setIsRecording(false);
        
        // Resolve with the blob only if it has data
        resolve(audioBlob.size > 0 ? audioBlob : null);
      };

      // Assign the stop handler
      recorderRef.current.onstop = handleStop;

      // Stop the recorder
      // Check state before stopping to avoid errors if already stopped
      if (recorderRef.current.state !== 'inactive') {
        console.log('Sending stop() command to MediaRecorder.');
        recorderRef.current.stop();
      } else {
        console.log('MediaRecorder already inactive, resolving manually.');
        // If already inactive, manually trigger the cleanup/resolve logic
        handleStop();
      }
    });
  }, []); // No dependencies needed for internal logic

  // Public function to stop recording
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (!isRecording) {
      console.warn('Not currently recording.');
      return null;
    }
    return stopRecordingInternal();
  }, [isRecording, stopRecordingInternal]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      console.log('Cleaning up media stream on unmount.');
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
    error,
    // Note: micStream is removed as it's an internal detail now
  };
} 