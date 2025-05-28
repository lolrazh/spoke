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
      isLongPress = false; // Reset on new press
      pressTimer = setTimeout(() => {
        isLongPress = true;
        if (!trans.recording) {
          trans.start(); // Start push-to-talk
        }
      }, HOLD_DURATION_MS);
    };

    const handleRightAltUp = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }

      if (isLongPress) {
        if (trans.recording) {
          trans.stop();
        }
      } else {
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
        clearTimeout(pressTimer);
      }
      unsubscribePTTDown();
      unsubscribePTTUp();
    };
  }, [trans.recording, trans.start, trans.stop, trans.ready, trans.processing]);

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