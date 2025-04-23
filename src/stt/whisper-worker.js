import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js
env.allowLocalModels = true;
// env.useBrowserCache = false; // Optional: Disable caching
// Set path to WASM files if not hosted alongside worker (needed for Electron)
// env.backends.onnx.wasm.wasmPaths = 'path/to/onnx-wasm/'; // Adjust path as necessary

let transcriber = null;
let currentModel = null;
let currentQuantized = null;

// Function to load the model
async function loadModel(model = 'Xenova/whisper-tiny.en', quantized = true) {
    if (transcriber !== null && currentModel === model && currentQuantized === quantized) {
        self.postMessage({ status: 'model-ready' });
        return;
    }

    self.postMessage({ status: 'loading', model });
    try {
        transcriber = await pipeline('automatic-speech-recognition', model, {
            quantized: quantized,
            progress_callback: (progress) => {
                self.postMessage({ status: 'progress', progress });
            },
            // Specify compute backend (webgpu, wasm) if needed, though auto-detection is default
            // device: 'webgpu' 
        });
        currentModel = model;
        currentQuantized = quantized;
        self.postMessage({ status: 'model-ready' });
    } catch (error) {
        console.error("Error loading model:", error);
        self.postMessage({ status: 'error', error: `Failed to load model ${model}: ${error.message}` });
    }
}

// Placeholder for audio buffer/stream processing
let audioBuffer = []; // Or a more sophisticated streaming buffer

// Function to handle transcription
async function transcribeAudio(audioData) {
    if (!transcriber) {
        self.postMessage({ status: 'error', error: 'Transcriber not initialized.' });
        return;
    }

    self.postMessage({ status: 'transcribing' });
    try {
        // Assuming audioData is Float32Array, may need conversion/resampling
        // This example assumes a complete audio buffer is passed for transcription
        // For streaming, you'd accumulate chunks and potentially run transcription periodically
        const output = await transcriber(audioData, {
            // Parameters for transcription (e.g., language, task)
            chunk_length_s: 30, // Example: Process in 30-second chunks
            stride_length_s: 5, // Example: Overlap chunks by 5 seconds
            // callback_function: (beams) => { // For partial results
            //     const partialText = transcriber.tokenizer.decode(beams[0].output_token_ids, {
            //         skip_special_tokens: true,
            //     });
            //     self.postMessage({ status: 'update', output: partialText });
            // }
        });

        self.postMessage({ status: 'complete', output: output.text });
        audioBuffer = []; // Clear buffer after processing

    } catch (error) {
        console.error("Error during transcription:", error);
        self.postMessage({ status: 'error', error: `Transcription failed: ${error.message}` });
    }
}

// Listen for messages from the main thread
self.onmessage = async (event) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'load-model':
            // Example: payload = { model: 'Xenova/whisper-base.en', quantized: false }
            // The implementation plan mentions loading from process.resourcesPath, 
            // which isn't directly accessible in a standard web worker.
            // This might require passing the model path/data differently, possibly as ArrayBuffer or URL.
            // Using Xenova/ model names for now as placeholders.
            await loadModel(payload?.model, payload?.quantized);
            break;

        case 'audio-chunk':
            // Accumulate audio data
            // This simple approach buffers all chunks until stop
            if (payload instanceof Float32Array) {
                audioBuffer.push(payload);
            }
            // For real-time updates, would need to trigger transcription more frequently
            break;

        case 'start-recording':
            // Reset buffer if needed when starting a new recording session
            audioBuffer = [];
            self.postMessage({ status: 'info', message: 'Recording started, ready for audio chunks.' });
            break;

        case 'stop-recording':
            // Process the accumulated audio when recording stops
            if (audioBuffer.length > 0) {
                const mergedAudio = mergeBuffers(audioBuffer);
                await transcribeAudio(mergedAudio);
            } else {
                self.postMessage({ status: 'complete', output: '' }); // No audio recorded
            }
            break;

        default:
            console.warn(`Worker received unknown message type: ${type}`);
            break;
    }
};

// Helper function to merge Float32Array buffers (same as in hook, could be utility)
function mergeBuffers(buffers) {
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
        result.set(buffer, offset);
        offset += buffer.length;
    }
    return result;
}

// Initial load of the default model
loadModel(); // Load tiny.en quantized by default 