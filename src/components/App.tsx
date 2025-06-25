import React, { useState, useEffect, useRef, useCallback } from 'react';
import Pill from './Pill';
// Import the new consolidated hook
import { useTranscription } from '../hooks/useTranscription'; // Adjust path if needed
import { ISLAND_HIDDEN_Y, ISLAND_VISIBLE_Y } from '../constants/window';
// Remove old audio import
// import { startRecording, stopRecording } from '../lib/audio';

// Placeholder transcription text (would be replaced with actual API call result)
// const PLACEHOLDER_TEXT = "This is a sample transcription. It will be inserted at your cursor position.";

const App: React.FC = () => {
  const trans = useTranscription();
  const [isHovered, setIsHovered] = useState(false);

  // Refs for the Right-Alt key logic
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef<boolean>(false);
  // Ref to always hold the latest trans object for use in callbacks
  const latestTransRef = useRef(trans);

  // --- Update latestTransRef whenever trans changes ---
  useEffect(() => {
    latestTransRef.current = trans;
  }, [trans]);

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

  // --- Handle Window Sliding for Dynamic Island Effect ---
  useEffect(() => {
    if (window.electronIsland?.slideTo) {
      const shouldBeVisible = isHovered || isListening || isProcessing;
      const targetY = shouldBeVisible ? ISLAND_VISIBLE_Y : ISLAND_HIDDEN_Y;
      
      window.electronIsland.slideTo(targetY);
    }
  }, [isHovered, isListening, isProcessing]);

  // --- RIGHT ALT key - Hold vs. Tap Logic ---
  useEffect(() => {
    if (!window.electron?.onPTTDown || !window.electron?.onPTTUp) return;

    const HOLD_DURATION_MS = 180; // ms

    const handleRightAltDown = () => {
      isLongPressRef.current = false; 
      // Clear any existing timer from a potentially missed 'up' event
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      pressTimerRef.current = setTimeout(() => {
        isLongPressRef.current = true;
        if (!latestTransRef.current.recording) {
          latestTransRef.current.start(); 
        }
      }, HOLD_DURATION_MS);
    };

    const handleRightAltUp = () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }

      if (isLongPressRef.current) {
        if (latestTransRef.current.recording) {
          latestTransRef.current.stop();
        }
      } else {
        if (latestTransRef.current.recording) {
          latestTransRef.current.stop();
        } else {
          latestTransRef.current.start();
        }
      }
      isLongPressRef.current = false; 
    };

    const unsubscribePTTDown = window.electron.onPTTDown(handleRightAltDown);
    const unsubscribePTTUp = window.electron.onPTTUp(handleRightAltUp);

    return () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      unsubscribePTTDown();
      unsubscribePTTUp();
    };
  }, [trans.start, trans.stop]);

  return (
    <div 
      className="app-container w-full h-screen bg-transparent overflow-hidden relative"
    >
      <Pill 
        isListening={isListening}
        isProcessing={isProcessing}
        isHovered={isHovered}
        // Connect Pill clicks directly to hook functions
        onStartDictation={trans.start}
        onStopDictation={trans.stop}
        onHoverChange={setIsHovered}
      />
    </div>
  );
};

export default App; 