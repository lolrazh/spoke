import { useState, useRef, useCallback, useEffect } from 'react';

// Placeholder types - replace with actual types from transformers.js or worker communication
type TranscriptionUpdateCallback = (text: string) => void;
type SilenceDetectedCallback = (text: string, audio: Float32Array) => void; // Assuming final text + audio on silence
type TranscriptionCompleteCallback = (text: string, audio: Float32Array) => void; // Assuming final text + audio on completion

interface UseWhisperRecorderOptions {
    onTranscriptionUpdate: TranscriptionUpdateCallback;
    onSilenceDetected: SilenceDetectedCallback;
    onTranscriptionComplete: TranscriptionCompleteCallback;
    // Add other options like silence threshold, model path, etc. if needed
}

// Basic structure, needs implementation details for audio processing, worker communication, silence detection
export function useWhisperRecorder({
    onTranscriptionUpdate,
    onSilenceDetected,
    onTranscriptionComplete
}: UseWhisperRecorderOptions) {
    const [isRecording, setIsRecording] = useState(false);
    const [transcriptionReady, setTranscriptionReady] = useState(false); // Or determined by worker status
    const [error, setError] = useState<string | null>(null);

    const workerRef = useRef<Worker | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | AudioWorkletNode | null>(null); // Or AudioWorkletNode
    const audioBufferRef = useRef<Float32Array[]>([]); // Store audio chunks

    // --- Initialization (Worker, AudioContext) ---
    useEffect(() => {
        // Initialize the Web Worker
        workerRef.current = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });

        workerRef.current.onmessage = (event) => {
            const message = event.data;
            // Handle messages from worker (status, transcription, errors)
            console.log("Worker message:", message);
            if (message.status === 'model-ready') {
                setTranscriptionReady(true);
            } else if (message.status === 'update') {
                onTranscriptionUpdate(message.output);
            } else if (message.status === 'complete') {
                // Assuming worker sends final audio buffer back or we handle it here
                const finalAudio = new Float32Array(); // Placeholder
                onTranscriptionComplete(message.output, finalAudio);
                // Consider if silence detection *also* triggers onTranscriptionComplete
            } else if (message.status === 'error') {
                setError(message.error || 'Unknown worker error');
            }
        };

        workerRef.current.onerror = (err) => {
            console.error("Worker error:", err);
            setError(`Worker error: ${err.message}`);
        };

        // Initialize AudioContext after first user gesture (e.g., inside startRecording)
        // audioContextRef.current = new window.AudioContext();

        // Set transcriptionReady based on worker loading status?
        // workerRef.current.postMessage({ type: 'load-model', payload: { modelPath: '...' }}); // Trigger model loading

        return () => {
            // Cleanup worker and audio resources
            stopRecordingInternal();
            workerRef.current?.terminate();
            audioContextRef.current?.close();
        };
    }, []); // Empty dependency array for single initialization

    // --- Silence Detection Logic ---
    // Needs implementation - analyze audioBufferRef for silence


    // --- Recording Control ---
    const startRecording = useCallback(async () => {
        if (isRecording || !transcriptionReady) return;
        setError(null);
        audioBufferRef.current = []; // Clear buffer

        try {
            // Initialize AudioContext on demand
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new window.AudioContext();
            } else if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            if (!audioContextRef.current) {
                throw new Error("AudioContext could not be initialized.");
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            const source = audioContextRef.current.createMediaStreamSource(stream);

            // Using ScriptProcessorNode for simplicity, consider AudioWorklet for performance
            const bufferSize = 4096; // Adjust as needed
            const processor = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);

            processor.onaudioprocess = (event) => {
                if (!isRecording) return; // Check state inside the callback

                const inputData = event.inputBuffer.getChannelData(0);
                // Clone data for buffering and sending to worker
                const audioChunk = inputData.slice();
                audioBufferRef.current.push(audioChunk);

                // Send audio data to worker (consider downsampling/format conversion if needed)
                workerRef.current?.postMessage({ type: 'audio-chunk', payload: audioChunk });

                // TODO: Implement silence detection here
                // if (isSilent(audioChunk)) {
                //   const completeTranscription = "..."; // Get from worker?
                //   const fullAudio = mergeAudioBuffers(audioBufferRef.current);
                //   onSilenceDetected(completeTranscription, fullAudio);
                //   stopRecordingInternal(); // Stop recording on silence
                // }
            };

            source.connect(processor);
            processor.connect(audioContextRef.current.destination); // Connect to output to avoid issues

            processorRef.current = processor;
            setIsRecording(true);

            // Notify worker recording has started (optional)
            workerRef.current?.postMessage({ type: 'start-recording' });

        } catch (err) {
            console.error("Error starting recording:", err);
            setError(err instanceof Error ? err.message : String(err));
            stopRecordingInternal(); // Clean up resources on error
        }
    }, [isRecording, transcriptionReady]); // Add dependencies as needed

    const stopRecordingInternal = useCallback(() => {
        // Internal function to stop streams, processor, etc. without triggering external callback loop
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        // Don't close audioContext here, might be needed again quickly

        setIsRecording(false);
    }, []);


    const stopRecording = useCallback(() => {
        if (!isRecording) return;

        stopRecordingInternal();

        // Notify worker that recording stopped explicitly
        workerRef.current?.postMessage({ type: 'stop-recording' });

        // Optionally wait for final transcription message from worker triggered by 'stop-recording'
        // Or immediately call onTranscriptionComplete if worker handles final processing internally
        // const finalAudio = mergeAudioBuffers(audioBufferRef.current);
        // const finalText = "..."; // How to get final text synchronously? Usually needs worker message.
        // onTranscriptionComplete(finalText, finalAudio); // This might be premature

    }, [isRecording, stopRecordingInternal]);

    // Helper to merge Float32Array chunks
    const mergeAudioBuffers = (buffers: Float32Array[]): Float32Array => {
        const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
        const result = new Float32Array(totalLength);
        let offset = 0;
        for (const buffer of buffers) {
            result.set(buffer, offset);
            offset += buffer.length;
        }
        return result;
    };


    return {
        startRecording,
        stopRecording,
        isRecording,
        transcriptionReady,
        error
    };
} 