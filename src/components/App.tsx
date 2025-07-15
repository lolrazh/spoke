import React, { useState, useEffect, useRef } from "react";
import Pill from "./Pill";
// Import the new consolidated hook
import { useTranscription } from "../hooks/useTranscription"; // Adjust path if needed
import { ISLAND_HIDDEN_Y, ISLAND_VISIBLE_Y } from "../constants/window";
// Remove old audio import
// import { startRecording, stopRecording } from '../lib/audio';

// Define the type for our new "notification play" state
type NotificationPlay = {
  text: string;
  phase: "shrinking" | "showing";
};

const App: React.FC = () => {
  const trans = useTranscription();
  const [isHovered, setIsHovered] = useState(false);
  const [notificationPlay, setNotificationPlay] =
    useState<NotificationPlay | null>(null);
  const notificationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);
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
      console.log(
        `[App] Final accumulated transcription state: "${trans.text}"`,
      );
    }
  }, [trans.text, trans.recording, trans.processing]);

  // --- Handle Errors from Hook ---
  useEffect(() => {
    if (trans.error) {
      // Use the new notifications API
      window.notifications.send(trans.error);
    }
  }, [trans.error]);

  // --- Global Notification Listener (The "Director") ---
  useEffect(() => {
    const cleanup = window.notifications.on((message: string) => {
      console.log(`[App] Kicking off notification play: "${message}"`);
      // Always clear any previous play's timers
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }

      // Act I: Take a breath
      setNotificationPlay({ text: message, phase: "shrinking" });

      // Act II: Deliver the line (after a short delay for the shrink animation)
      notificationTimerRef.current = setTimeout(() => {
        setNotificationPlay({ text: message, phase: "showing" });

        // Act III: End the play (after the notification has been visible)
        notificationTimerRef.current = setTimeout(() => {
          setNotificationPlay(null);
          notificationTimerRef.current = null;
        }, 2200); // Notification visibility duration
      }, 300); // Synchronize with the new faster animation duration
    });

    return () => {
      // Cleanup the listener and the timer when the component unmounts
      cleanup();
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
    };
  }, []); // Empty dependency array means this runs once on mount

  // --- Derived State for Pill Visibility ---
  const isPillVisible = isListening || !!notificationPlay;

  // Island slide-in/out effect
  useEffect(() => {
    // Use the new island API
    if (window.island?.slideTo) {
      const targetY = isPillVisible ? ISLAND_VISIBLE_Y : ISLAND_HIDDEN_Y;
      console.log(
        `[App] Sliding to ${targetY} (isListening: ${isListening}, hasNotification: ${!!notificationPlay})`,
      );
      window.island.slideTo(targetY);
    }
  }, [isPillVisible]);

  // Set up global PTT hotkey listeners
  useEffect(() => {
    // Use the new PTT API
    if (!window.ptt?.onDown || !window.ptt?.onUp) return;

    const HOLD_DURATION_MS = 180;

    const handleFunctionKeyDown = () => {
      // Always clear the previous timer on a new key down event.
      // This correctly handles keyboard repeats.
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }

      // Don't start a new timer if PTT is already active from a long press.
      if (latestTransRef.current.recording) {
        return;
      }

      isLongPressRef.current = false;
      pressTimerRef.current = setTimeout(() => {
        isLongPressRef.current = true;
        // Use the ref to ensure we have the latest `start` function.
        if (!latestTransRef.current.recording) {
          latestTransRef.current.start();
        }
      }, HOLD_DURATION_MS);
    };

    const handleFunctionKeyUp = () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }

      // Use the ref to ensure we have the latest functions and state.
      if (isLongPressRef.current) {
        if (latestTransRef.current.recording) {
          latestTransRef.current.stop();
        }
      } else {
        // Toggle behavior for short press
        if (latestTransRef.current.recording) {
          latestTransRef.current.stop();
        } else {
          latestTransRef.current.start();
        }
      }
      isLongPressRef.current = false;
    };

    console.log("[PTT] Setting up PTT listeners");
    const unsubscribePTTDown = window.ptt.onDown(handleFunctionKeyDown);
    const unsubscribePTTUp = window.ptt.onUp(handleFunctionKeyUp);

    return () => {
      console.log("[PTT] Cleaning up PTT listeners");
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      unsubscribePTTDown();
      unsubscribePTTUp();
    };
  }, []); // Removed dependencies as we are now using a ref

  return (
    <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
      <Pill
        isListening={isListening}
        isProcessing={isProcessing}
        isHovered={isHovered}
        notificationPlay={notificationPlay}
        // Connect Pill clicks directly to hook functions
        onStartDictation={trans.start}
        onStopDictation={trans.stop}
        onHoverChange={setIsHovered}
      />
    </div>
  );
};

export default App;
