import React, { useState, useEffect, useRef, useCallback } from 'react';
import Pill from './Pill';
// Import the new consolidated hook
import { useTranscription } from '../hooks/useTranscription'; // Adjust path if needed
// Remove old audio import
// import { startRecording, stopRecording } from '../lib/audio';

// Placeholder transcription text (would be replaced with actual API call result)
// const PLACEHOLDER_TEXT = "This is a sample transcription. It will be inserted at your cursor position.";

const App: React.FC = () => {
  // Instantiate the new hook
  const trans = useTranscription();

  // --- REMOVE TEMPORARY State --- 
  // const [isListening, setIsListening] = useState(false); 
  // const [isLoading, setIsLoading] = useState(false); 

  // --- Map hook state to Pill props --- 
  const isListening = trans.recording; 
  // Show processing during model load AND transcription
  const isProcessing = !trans.ready || trans.processing; 

  // --- Connect Hotkey logic to the new hook --- 
  useEffect(() => {
    if (!window.electron) return;

    const handleToggleDictation = () => {
      console.log('Toggle hotkey. State:', { 
          recording: trans.recording, 
          processing: trans.processing, 
          ready: trans.ready 
      });
      if (trans.recording) {
        trans.stop(); // Call hook's stop function
      } else if (trans.ready && !trans.processing) { // Only start if ready and not busy
        trans.start(); // Call hook's start function
      } else {
          console.warn('Cannot toggle dictation: Not ready or currently processing.');
          // Optionally notify user
          if (!trans.ready) window.electron?.sendNotification('Engine loading...');
          if (trans.processing) window.electron?.sendNotification('Processing audio...');
      }
    };

    const cleanup = window.electron.toggleDictation(handleToggleDictation);
    return cleanup;
    // Dependencies are now from the hook
  }, [trans.recording, trans.processing, trans.ready, trans.start, trans.stop]);

  // --- Handle Transcription Results (REMOVED PASTE LOGIC PREVIOUSLY, ADDING IT BACK) --- 
  useEffect(() => {
    // Only paste when recording stops, processing finishes, AND there's text.
    if (!trans.recording && !trans.processing && trans.ready && trans.text) {
      const textToInsert = trans.text; // Get the final accumulated text
      console.log(`[App] Pasting final accumulated text: "${textToInsert}"`);
      if (textToInsert && window.electron) { 
          window.electron.insertTextAtCursor(textToInsert) // Paste the full text
            .then(insertResult => {
              if (!insertResult.success && insertResult.error) {
                console.error('[App] Insertion Error:', insertResult.error);
                window.electron?.sendNotification(insertResult.error);
              }
            })
            .catch(err => {
                console.error('[App] Error during insertTextAtCursor IPC:', err);
                window.electron?.sendNotification('Failed to insert text.');
            });
      } else {
          console.log('[App] Final transcription result was empty or electron API unavailable, not inserting.');
      }
    }
  }, [trans.recording, trans.processing, trans.ready, trans.text]); // Dependencies that signal completion

  // --- Handle Errors from Hook --- 
  useEffect(() => {
    if (trans.error && window.electron) {
      console.error('[App] Transcription Hook Error:', trans.error);
      window.electron.sendNotification(trans.error); 
    }
  }, [trans.error]); // Watch for changes in the hook's error state

  return (
    <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
      <Pill 
        isListening={isListening}
        isProcessing={isProcessing} 
        // Connect Pill clicks directly to hook functions
        onStartDictation={trans.start}
        onStopDictation={trans.stop}
      />
    </div>
  );
};

export default App; 