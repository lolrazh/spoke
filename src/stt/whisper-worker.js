import { pipeline, env } from '@huggingface/transformers';

// Configuration
const MODEL_NAME = 'onnx-community/whisper-base'; // Use tiny English-only (pre-quantized) for speed
const TASK = 'automatic-speech-recognition';
const LANGUAGE = 'english'; // Model is English-only now

// --- Configure for local model loading ---
// Define the path relative to the server root where models are stored
env.localModelPath = '/models/'; // Path within the built app (points to public/models)
env.allowRemoteModels = false; // Disable downloading from Hugging Face
// env.allowLocalModels = true; // Defaults to true, so no need to set explicitly

// Global variable to hold the pipeline instance
let transcriber = null;

// Listener for messages from the main thread
self.addEventListener('message', async (event) => {
    const { type, audio } = event.data;

    if (type === 'init') {
        // Initialize the pipeline
        try {
            self.postMessage({ status: 'loading-model' });
            
            console.time('pipeline-instantiate'); // START TIMER
            // Load the pipeline
            transcriber = await pipeline(TASK, MODEL_NAME, {
                quantized: true, // CORRECT: Use pre-quantized weights in whisper-tiny.en
                progress_callback: (progress) => {
                    // Post loading progress
                    self.postMessage({ status: 'loading-progress', progress });
                },
                // Explicitly request webgpu, transformers.js will fallback if unavailable
                // device: 'webgpu', // Let transformers.js auto-select backend
            });
            console.timeEnd('pipeline-instantiate'); // END TIMER

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