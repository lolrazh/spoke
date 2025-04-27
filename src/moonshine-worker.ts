// src/moonshine-worker.ts
import { 
    pipeline, 
    env, 
    // @ts-ignore Progress type might be nested or different now
    Progress 
} from "@huggingface/transformers";

const MODEL_ID = "onnx-community/moonshine-base-ONNX";   // English-only                          // a bit roomier

// Define type for Dtype configuration
type DtypeConfig = Record<string, "fp32" | "fp16" | "q8" | "q4" | "int8">; // Adjust allowed types if needed

// Define dtype configurations based on device with explicit typing
const DEVICE_DTYPE_CONFIGS: Record<string, DtypeConfig> = {
  webgpu: {
    encoder_model: "fp32", // Example values, adjust if needed based on testing/performance
    decoder_model_merged: "q4",
  },
  wasm: {
    encoder_model: "fp32",
    decoder_model_merged: "q8", // WASM might benefit from q8
  },
};

// --- back-end selection exactly like before ---------------------------------
async function webgpuAvailable() {
  // @ts-ignore
  return !!navigator.gpu && (await navigator.gpu.requestAdapter()) !== null;
}

const useGpu = await webgpuAvailable();
const device = useGpu ? 'webgpu' : 'wasm';
const dtypeConfig = DEVICE_DTYPE_CONFIGS[device];

if (useGpu) {
    console.log("[Moonshine] using WebGPU backend");
    // Additional WebGPU specific settings if needed (e.g., powerPreference)
    // @ts-ignore
    // env.backends.webgpu.powerPreference = "high-performance"; // Can potentially be set here if needed
} else {
    console.log("[Moonshine] using WASM backend");
    // @ts-ignore
    // env.backends.wasm.numThreads = navigator.hardwareConcurrency ?? 4; // This might need to be passed differently or handled by the library
}

// ---------------------------------------------------------------------------

let asr: Awaited<ReturnType<typeof pipeline>> | null = null;
let busy = false;

self.postMessage({ status: "loading" });

asr = await pipeline(
  "automatic-speech-recognition",
  MODEL_ID,
  {
    progress_callback: (p: Progress | null) => p && self.postMessage(p),
    // Pass device and dtype config directly
    device: device,
    dtype: dtypeConfig,
    // max_new_tokens: MAX_NEW_TOKENS, // Keep if needed, was removed in previous step's paste
  }
);

self.postMessage({ status: "ready" });

self.addEventListener("message", async (e) => {
  const { type, data } = e.data ?? {};
  if (type !== "generate" || busy) return;

  busy = true;
  self.postMessage({ status: "start" });

  // Start timing the pipeline call
  const t0 = performance.now();
  try {
    // Get the full result object first
    const result = await asr!(data.audio as Float32Array);
    // Calculate the time taken for the pipeline
    const pipelineTime = performance.now() - t0;

    // Access the text property (assuming non-array output for this setup)
    const text = (result as any).text; // Use 'as any' for now, or refine type if needed

    self.postMessage({
      status: "complete",
      output: text?.trim() ?? '', // Handle potential null/undefined text
      // Send back the total pipeline time
      timings: { total: pipelineTime },
    });
  } catch (err) {
    // Ensure timing ends even on error, though we don't report it in this case
    const pipelineTimeOnError = performance.now() - t0;
    console.error(`[Moonshine] Error after ${pipelineTimeOnError.toFixed(2)}ms:`, err);
    self.postMessage({ status: "error", error: String(err) });
  } finally {
    busy = false;
  }
});