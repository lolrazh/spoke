import React, { useState, useEffect, useRef, useCallback } from 'react';
import Pill from './Pill';
// Remove old audio import
// import { startRecording, stopRecording } from '../lib/audio';

// Import the new hooks
import { useWhisperRecorder } from '../stt/useWhisperRecorder';
import { useWhisperRecognition } from '../stt/useWhisperRecognition';

// Placeholder transcription text (would be replaced with actual API call result)
// const PLACEHOLDER_TEXT = "This is a sample transcription. It will be inserted at your cursor position.";

const App: React.FC = () => {
  // State from hooks
  const recorder = useWhisperRecorder();
  const recognizer = useWhisperRecognition();

  // Derived state for the Pill component
  const isLoading = recognizer.isModelLoading || recognizer.isTranscribing;
  const isReady = recognizer.isReady;
  const isListening = recorder.isRecording;

  // Handle toggle dictation from shortcut
  useEffect(() => {
    if (!window.electron) return;

    const handleToggleDictation = () => {
      console.log('Toggle dictation shortcut pressed. States:', {
        isListening: recorder.isRecording, 
        isLoadingModel: recognizer.isModelLoading,
        isTranscribing: recognizer.isTranscribing,
        isReady: recognizer.isReady
      });
      
      if (recorder.isRecording) {
        // Currently recording, so stop
        handleStopDictation();
      } else if (recognizer.isReady && !recognizer.isModelLoading && !recognizer.isTranscribing) {
        // Ready and not busy, so start
        handleStartDictation();
      } else if (recognizer.isModelLoading) {
        console.log('Model is still loading.');
        window.electron?.sendNotification('Model is loading...');
      } else if (recognizer.isTranscribing) {
        console.log('Still processing previous dictation.');
        window.electron?.sendNotification('Still processing...');
      } else {
        console.warn('Cannot start dictation in current state.');
        // Optionally notify user if model init failed previously
        if (!recognizer.isReady) {
           window.electron?.sendNotification('Transcription model not ready.');
        }
      }
    };

    // Register for hotkey events
    const cleanup = window.electron.toggleDictation(handleToggleDictation);

    // Cleanup listener on unmount or dependency change
    return cleanup;
  }, [recorder.isRecording, recognizer.isReady, recognizer.isModelLoading, recognizer.isTranscribing]); // Dependencies reflect states checked

  // Handle transcription results
  useEffect(() => {
    if (recognizer.transcriptionText && window.electron) {
      const textToInsert = recognizer.transcriptionText.trim();
      console.log(`Received transcription result: "${textToInsert}"`);
      if (textToInsert) { // Only insert if not empty after trimming
          console.log('Inserting transcribed text at cursor...');
          window.electron.insertTextAtCursor(textToInsert)
            .then(insertResult => {
              if (!insertResult.success && insertResult.error) {
                console.error('Insertion Error:', insertResult.error);
                window.electron?.sendNotification(insertResult.error);
              }
            })
            .catch(err => {
                console.error('Error during insertTextAtCursor IPC:', err);
                window.electron?.sendNotification('Failed to insert text.');
            });
      } else {
          console.log('Transcription result was empty after trimming, not inserting.');
      }
    }
  }, [recognizer.transcriptionText]); // Watch for new transcription text

  // Handle errors from hooks
  useEffect(() => {
    const combinedError = recorder.error || recognizer.error;
    if (combinedError && window.electron) {
      console.error('Hook Error:', combinedError);
      window.electron.sendNotification(combinedError); // Show error to user
    }
  }, [recorder.error, recognizer.error]);

  // --- Event Handlers using Hooks ---

  const handleStartDictation = useCallback(async () => {
    if (!recognizer.isReady) {
        console.warn('Recognition model not ready, cannot start recording.');
        window.electron?.sendNotification('Model not ready yet.');
        return;
    }
    console.log('=== DICTATION START PROCESS ===');
    try {
      await recorder.startRecording();
      // No need for main process IPC startRecording anymore
      console.log('=== DICTATION START COMPLETE ===');
    } catch (error) {
      // Error state is handled by the hook's useEffect
      console.error('=== DICTATION START FAILED ===', error);
    }
  }, [recorder.startRecording, recognizer.isReady]); // Add recognizer.isReady

  const handleStopDictation = useCallback(async () => {
    console.log('=== DICTATION STOP PROCESS ===');
    try {
      const audioBlob = await recorder.stopRecording();
      // No need for main process IPC stopRecording anymore

      if (audioBlob) {
        console.log('Audio blob received, sending for transcription...');
        // Pass the blob to the recognition hook
        recognizer.transcribeAudio(audioBlob);
      } else {
        console.log('Audio blob was null or empty, skipping transcription.');
        // Optionally notify user? Or just do nothing.
      }
      console.log('=== DICTATION STOP/PROCESS TRIGGERED ===');
    } catch (error) {
      // Error state is handled by the hook's useEffect
      console.error('=== DICTATION STOP FAILED ===', error);
    }
  }, [recorder.stopRecording, recognizer.transcribeAudio]); // Add recognizer.transcribeAudio

  return (
    <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
      <Pill 
        // Pass relevant states to the Pill
        isListening={isListening} 
        isProcessing={isLoading} // Combined loading state
        onStartDictation={handleStartDictation}
        onStopDictation={handleStopDictation}
      />
    </div>
  );
};

export default App; 