console.log("[VadWorker] VAD worker starting to load...");

import { AutoModel, Tensor } from "@huggingface/transformers";
import type {
  VadWorkerMessage,
  VadInitializedMessage,
  VadResultMessage,
  VadErrorMessage,
} from "../types/worker-messages";

// VAD configuration
const VAD_MODEL_ID = "onnx-community/silero-vad";
const TARGET_SAMPLE_RATE = 16000;
const SPEECH_TH = 0.6;
const EXIT_TH = 0.25;

// VAD state
let vad: ((x: {
  input: Tensor;
  sr: Tensor;
  state: Tensor;
}) => Promise<{ stateN: Tensor; output: Tensor }>) | null = null;

const srTensor = new Tensor("int64", [TARGET_SAMPLE_RATE], []);
let vadState = new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
let wasSpeech = false;

console.log("[VadWorker] Imports completed successfully");

// Initialize VAD model
async function initializeVad(): Promise<void> {
  try {
    console.log("[VadWorker] Initializing Silero VAD model...");
    
    vad = (await AutoModel.from_pretrained(VAD_MODEL_ID, {
      config: { model_type: "custom" } as any,
      dtype: "fp32", // tiny model; fp32 is fine
    })) as typeof vad;
    
    console.log("[VadWorker] Silero VAD loaded successfully.");
  } catch (error) {
    console.error("[VadWorker] Failed to initialize VAD model:", error);
    throw error;
  }
}

// Perform VAD detection on audio frame
async function detectSpeech(frame: Float32Array): Promise<{ isSpeech: boolean; probability: number }> {
  if (!vad) {
    throw new Error("VAD model not initialized");
  }

  const input = new Tensor("float32", frame, [1, frame.length]);
  
  try {
    const { stateN, output } = await vad({ input, sr: srTensor, state: vadState });
    vadState = stateN;
    const probability = output.data[0] as number;
    
    // Apply hysteresis for speech detection
    const isSpeech = probability > SPEECH_TH || (wasSpeech && probability >= EXIT_TH);
    wasSpeech = isSpeech;
    
    return { isSpeech, probability };
  } catch (error) {
    console.error("[VadWorker] VAD detection error:", error);
    throw error;
  }
}

// Message handling
self.addEventListener("message", async (e) => {
  const message: VadWorkerMessage = e.data;

  try {
    switch (message.type) {
      case "vad_init": {
        console.log("[VadWorker] Received initialization request");
        await initializeVad();
        
        const response: VadInitializedMessage = {
          type: "vad_initialized",
          success: true,
        };
        self.postMessage(response);
        break;
      }

      case "vad_detect": {
        const { frameId, audioFrame } = message;
        
        if (!vad) {
          throw new Error("VAD model not initialized. Call vad_init first.");
        }

        const { isSpeech, probability } = await detectSpeech(audioFrame);
        
        const response: VadResultMessage = {
          type: "vad_result",
          frameId,
          isSpeech,
          probability,
        };
        self.postMessage(response);
        break;
      }

      default:
        console.warn("[VadWorker] Unknown message type:", (message as any).type);
    }
  } catch (error) {
    console.error("[VadWorker] Error processing message:", error);
    
    const errorResponse: VadErrorMessage = {
      type: "vad_error",
      frameId: "frameId" in message ? message.frameId : undefined,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    self.postMessage(errorResponse);
  }
});

// Error handling
self.onerror = (event) => {
  console.error("[VadWorker] Unhandled error:", event);
  const errorResponse: VadErrorMessage = {
    type: "vad_error",
    error: "Unhandled worker error",
  };
  self.postMessage(errorResponse);
};

self.onunhandledrejection = (event) => {
  console.error("[VadWorker] Unhandled promise rejection:", event);
  const errorResponse: VadErrorMessage = {
    type: "vad_error",
    error: "Unhandled promise rejection",
  };
  self.postMessage(errorResponse);
};

console.log("[VadWorker] VAD worker loaded and ready for messages"); 