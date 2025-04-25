import React, { useState, useEffect, useRef, useCallback } from 'react';
import Pill from './Pill';
// Remove old audio import
// import { startRecording, stopRecording } from '../lib/audio';

// Placeholder transcription text (would be replaced with actual API call result)
// const PLACEHOLDER_TEXT = "This is a sample transcription. It will be inserted at your cursor position.";

const App: React.FC = () => {
  // Placeholder state for Pill props - will be replaced by new hook
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false); // Example state

  // Example handlers - will be replaced
  const handleStartDictation = useCallback(() => {
    console.log("Start dictation (placeholder)");
    setIsListening(true);
    setIsLoading(false); // Example
  }, []);

  const handleStopDictation = useCallback(() => {
    console.log("Stop dictation (placeholder)");
    setIsListening(false);
    setIsLoading(true); // Example: show processing after stop
    setTimeout(() => setIsLoading(false), 1500); 
  }, []);

  // Handle toggle dictation from shortcut
  useEffect(() => {
    if (!window.electron) return;

    const handleToggleDictation = () => {
      console.log('Toggle dictation shortcut pressed (using placeholder state)');
      if (isListening) {
        handleStopDictation();
      } else if (!isLoading) { // Prevent starting while "processing"
        handleStartDictation();
      } else {
        console.log('Still processing (placeholder)');
        window.electron?.sendNotification('Still processing...');
      }
    };

    const cleanup = window.electron.toggleDictation(handleToggleDictation);
    return cleanup;
  }, [isListening, isLoading, handleStartDictation, handleStopDictation]); 

  // TODO: Add useEffect for handling transcription results from the new hook
  // TODO: Add useEffect for handling errors from the new hook

  return (
    <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
      <Pill 
        isListening={isListening}
        isProcessing={isLoading} 
        onStartDictation={handleStartDictation}
        onStopDictation={handleStopDictation}
      />
    </div>
  );
};

export default App; 