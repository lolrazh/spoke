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

  // --- Handle Transcription Results ---
  useEffect(() => {
    if (trans.text && !trans.recording && !trans.processing) {
      console.log(`[App] Final accumulated transcription state: "${trans.text}"`);
    }
  }, [trans.text, trans.recording, trans.processing]);

  // --- Handle Errors from Hook --- 
  useEffect(() => {
    if (trans.error && window.electron) {
      console.error('[App] Transcription Hook Error:', trans.error);
      window.electron.sendNotification(trans.error); 
    }
  }, [trans.error]);

  // --- RIGHT ALT key - Hold vs. Tap Logic ---
  useEffect(() => {
    if (!window.electron?.onPTTDown || !window.electron?.onPTTUp) return;

    const HOLD_DURATION_MS = 180; // ms
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let isLongPress = false;

    const handleRightAltDown = () => {
      console.log('[App] Right Alt DOWN');
      isLongPress = false; // Reset on new press
      pressTimer = setTimeout(() => {
        isLongPress = true;
        console.log('[App] Right Alt LONG PRESS detected');
        if (!trans.recording) {
          console.log('[App] Starting PTT recording (long press)');
          trans.start(); // Start push-to-talk
        }
      }, HOLD_DURATION_MS);
    };

    const handleRightAltUp = () => {
      console.log('[App] Right Alt UP');
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }

      if (isLongPress) {
        // If it was a long press (PTT), stop recording on release
        if (trans.recording) {
          console.log('[App] Stopping PTT recording (long press release)');
          trans.stop();
        }
      } else {
        // If it was a short press (tap), toggle hands-free mode
        console.log('[App] Short tap detected, toggling hands-free');
        if (trans.recording) {
          trans.stop();
        } else {
          trans.start();
        }
      }
      isLongPress = false; // Reset for next press cycle
    };

    const unsubscribePTTDown = window.electron.onPTTDown(handleRightAltDown);
    const unsubscribePTTUp = window.electron.onPTTUp(handleRightAltUp);

    return () => {
      if (pressTimer) {
        clearTimeout(pressTimer); // Clear timer on unmount
      }
      unsubscribePTTDown();
      unsubscribePTTUp();
      console.log('[App] Cleaned up Right Alt listeners');
    };
  }, [trans.recording, trans.start, trans.stop, trans.ready, trans.processing]); // Added trans.ready and trans.processing

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