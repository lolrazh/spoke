// a good bulk of this is from https://github.com/xenova/whisper-web/blob/main/src/worker.js
import { pipeline, env } from '@xenova/transformers';

// Configuration
const MODEL_NAME = 'onnx-community/whisper-base'; // Use the tiny model as requested
const TASK = 'automatic-speech-recognition';
const LANGUAGE = 'english'; // Assuming English for now

// Disable local models if not needed, set WebGPU as preferred device
env.allowLocalModels = false;
// env.backends.onnx.device = 'webgpu'; // Let transformers.js handle device selection automatically first

// Global variable to hold the pipeline instance
let transcriber = null;

// Listener for messages from the main thread
self.addEventListener('message', async (event) => {
    const { type, audio } = event.data;

    if (type === 'init') {
        // Initialize the pipeline
        try {
            self.postMessage({ status: 'loading-model' });
            
            // Load the pipeline
            transcriber = await pipeline(TASK, MODEL_NAME, {
                quantized: true, // Use quantized model for efficiency
                progress_callback: (progress) => {
                    // Post loading progress
                    self.postMessage({ status: 'loading-progress', progress });
                },
                // Explicitly request webgpu, transformers.js will fallback if unavailable
                device: 'webgpu', 
            });

            self.postMessage({ status: 'init-complete' });
        } catch (error) {
            console.error('Error loading model in worker:', error);
            self.postMessage({ status: 'init-error', error: error.message });
        }
    } else if (type === 'transcribe') {
        // Perform transcription
        if (!transcriber) {
            console.error('Transcriber not initialized.');
            self.postMessage({ status: 'transcription-error', error: 'Transcriber not ready.' });
            return;
        }
        if (!audio) {
            console.error('No audio data received for transcription.');
             self.postMessage({ status: 'transcription-error', error: 'No audio data received.' });
            return;
        }

        try {
            self.postMessage({ status: 'transcribing' });
            
            // Perform transcription
            // The pipeline expects audio as a Float32Array sampled at 16kHz
            // We assume the input `audio` is already in the correct format.
            // If not, conversion needs to happen *before* sending to the worker,
            // likely in `useWhisperRecognition`.
            const output = await transcriber(audio, {
                language: LANGUAGE,
                task: 'transcribe',
            });
            
            const transcriptionText = output?.text || '';

            self.postMessage({
                status: 'transcription-result',
                text: transcriptionText,
            });
        } catch (error) {
            console.error('Error during transcription in worker:', error);
            self.postMessage({ status: 'transcription-error', error: error.message });
        }
    }
});