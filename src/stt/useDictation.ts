import { useWhisperRecorder } from './useWhisperRecorder';
import { useEffect } from 'react';

interface UseDictationOptions {
    onPartial(text: string): void;
    onFinal(text: string, audio: Float32Array): void;
    onError(err: string): void;
    // Potentially add options for model selection, etc.
}

/**
 * Hook to manage the overall dictation process using the Whisper recorder.
 */
export function useDictation({
    onPartial,
    onFinal,
    onError,
}: UseDictationOptions) {

    // Use the recorder hook, passing down the relevant callbacks
    const {
        startRecording,
        stopRecording,
        isRecording,
        transcriptionReady, // Renamed to 'ready' in the return object
        error,
    } = useWhisperRecorder({
        onTranscriptionUpdate: onPartial, // Pass partial updates directly
        onSilenceDetected: onFinal,     // Trigger final callback on silence
        onTranscriptionComplete: onFinal, // Also trigger final callback on explicit stop/completion
        // Pass other necessary options like model paths if configured here
    });

    // Propagate errors from the recorder hook
    useEffect(() => {
        if (error) {
            onError(error);
        }
    }, [error, onError]);

    // Expose a simplified interface matching the implementation plan
    return {
        start: startRecording,
        stop: stopRecording,
        isRecording,
        ready: transcriptionReady, // Expose the readiness state
    };
} 