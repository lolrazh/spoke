import {
    AutoTokenizer,
    AutoProcessor,
    WhisperForConditionalGeneration,
    env,
    // @ts-ignore Progress type might be nested or different now
    Progress,
    Tensor, // Import Tensor
} from '@huggingface/transformers';

// --- Type Definitions (Basic) ---
type ProgressCallback = (progress: Progress | null) => void;

const MODEL_NAME = 'onnx-community/whisper-tiny'; // Keep base model
const MAX_NEW_TOKENS = 64;

// --- Helper to check WebGPU --- 
const webgpuAvailable = async (): Promise<boolean> => {
    // @ts-ignore navigator.gpu might not be in default TS lib
    if (!navigator.gpu) return false;
    try {
        // @ts-ignore
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    } catch (e) {
        console.warn('Error requesting WebGPU adapter:', e);
        return false;
    }
};

/**
 * This class uses the Singleton pattern to ensure that only one instance of the model is loaded.
 */
class AutomaticSpeechRecognitionPipeline {
    static model_id: string = MODEL_NAME;
    static tokenizer: AutoTokenizer | null = null;
    static processor: AutoProcessor | null = null;
    static model: WhisperForConditionalGeneration | null = null;

    static async getInstance(progress_callback: ProgressCallback | null = null): Promise<[AutoTokenizer, AutoProcessor, WhisperForConditionalGeneration]> {

        // Ensure components are initialized, awaiting promises
        this.tokenizer = this.tokenizer ?? await AutoTokenizer.from_pretrained(this.model_id, {
            progress_callback,
        });
        this.processor = this.processor ?? await AutoProcessor.from_pretrained(this.model_id, {
            progress_callback,
        });

        if (!this.model) {
            // Ensure backends object exists, including onnx
            env.backends = env.backends ?? { onnx: {} }; 
            // @ts-ignore
            env.backends.onnx = env.backends.onnx ?? {}; 
            // @ts-ignore
            env.backends.wasm = env.backends.wasm ?? {}; 
            // @ts-ignore
            env.backends.webgpu = env.backends.webgpu ?? {};

            // choose backend once
            if (await webgpuAvailable()) {
                // Use direct assignment if backend is not on top-level env
                // env.backend = 'webgpu'; 
                // env.computeType = 'fp16';
                // Assign properties to the specific backend object
                // @ts-ignore
                env.backends.webgpu.backend = 'webgpu'; // Set backend preference within specific object if needed
                // @ts-ignore
                env.backends.webgpu.computeType = 'fp16';
                // @ts-ignore
                env.backends.webgpu.powerPreference = 'high-performance'; 
                console.log('[Whisper] Singleton trying WebGPU backend');
            } else {
                // env.backend = 'wasm';
                // env.computeType = 'int8';
                 // @ts-ignore
                env.backends.wasm.backend = 'wasm';
                 // @ts-ignore
                env.backends.wasm.simd = true;
                 // @ts-ignore
                env.backends.wasm.numThreads = navigator.hardwareConcurrency ?? 4;
                // @ts-ignore
                env.backends.wasm.computeType = 'int8';
                console.log('[Whisper] Singleton using WASM backend');
            }
            
            console.time('model-instantiate');
            // Cast the result if necessary, assuming from_pretrained returns the correct type
            this.model = await WhisperForConditionalGeneration.from_pretrained(
                this.model_id,
                {
                    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' }, 
                    progress_callback,
                },
            ) as WhisperForConditionalGeneration; // Add type assertion
            console.timeEnd('model-instantiate');
        }
        
        // Since we await above, all components should be non-null here
        // Add a runtime check just in case, although TypeScript won't know
        if (!this.tokenizer || !this.processor || !this.model) {
            throw new Error("Failed to initialize all pipeline components.");
        }

        // Return the initialized components
        return [this.tokenizer, this.processor, this.model];
    }
}

let processing: boolean = false;

interface GenerateParams {
    audio: Float32Array;
    language: string;
}

async function generate({ audio, language }: GenerateParams): Promise<void> {
    if (processing) return;
    processing = true;

    self.postMessage({ status: 'start' });
    const [tokenizer, processor, model] = await AutomaticSpeechRecognitionPipeline.getInstance();

    // --- Granular Timings --- 
    let featureExtractionTime = 0;
    let modelGenerationTime = 0;
    let decodingTime = 0;
    const totalStartTime = performance.now(); // Overall worker processing start

    try {
        // 1. Feature Extraction
        const feStartTime = performance.now();
        // @ts-ignore
        const inputs = await processor.feature_extractor(audio);
        featureExtractionTime = performance.now() - feStartTime;

        // 2. Model Generation
        const genStartTime = performance.now();
        const outputs = await model.generate({
            ...inputs, 
            max_new_tokens: MAX_NEW_TOKENS,
            language,
        });
        modelGenerationTime = performance.now() - genStartTime;

        // 3. Decoding
        const decodeStartTime = performance.now();
        // @ts-ignore 
        const outputText = tokenizer.batch_decode(outputs, { skip_special_tokens: true });
        decodingTime = performance.now() - decodeStartTime;

        const totalEndTime = performance.now(); // Overall worker processing end
        const totalProcessingTime = totalEndTime - totalStartTime;

        // Send the output back to the main thread
        self.postMessage({
            status: 'complete',
            output: Array.isArray(outputText) ? outputText.join(' ') : String(outputText),
            timings: { // Send all timings back
                total: totalProcessingTime,
                featureExtraction: featureExtractionTime,
                modelGeneration: modelGenerationTime,
                decoding: decodingTime,
            }
        });

    } catch (error) {
        console.error("[Whisper] Error during generation:", error);
        self.postMessage({ 
            status: 'error', 
            error: error instanceof Error ? error.message : String(error)
        });
    } finally {
        processing = false;
    }
}

async function load(): Promise<void> {
    self.postMessage({
        status: 'loading',
        data: 'Loading model...'
    });

    const progressCallback: ProgressCallback = (x: Progress | null) => {
        if (x) {
            self.postMessage(x);
        }
    };

    // Get model instance (this loads tokenizer, processor, and model weights)
    // This instantiation might be enough warm-up
    try {
        console.log('[Whisper] Loading model components...');
        await AutomaticSpeechRecognitionPipeline.getInstance(progressCallback);
        console.log('[Whisper] Model components loaded.');
        
        // No explicit warm-up/dummy generation needed - remove that block

        self.postMessage({ status: 'ready' });
        console.log('[Whisper] Worker is ready.');

    } catch (loadError) {
        console.error('[Whisper] Failed to load model components:', loadError);
        self.postMessage({ status: 'error', error: 'Failed to load model' });
    }
}

// Listen for messages from the main thread
self.addEventListener('message', async (e: MessageEvent) => {
    // Use clearer names and add basic type check
    const messageData = e.data as { type: string; data?: any }; 
    const type = messageData.type;
    const data = messageData.data;

    switch (type) {
        case 'load':
            await load();
            break;

        case 'generate':
            if (data && typeof data.audio !== 'undefined' && typeof data.language === 'string') {
                 await generate(data as GenerateParams);
            } else {
                console.error("Invalid data format for 'generate' message:", data);
                self.postMessage({ status: 'transcription-error', error: 'Invalid data format' });
            }
            break;
    }
});