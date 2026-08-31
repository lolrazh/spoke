/**
 * Test helper for exercising the REAL @ricky0123/vad-web `FrameProcessor` /
 * `NonRealTimeVAD` state machines without loading the actual Silero ONNX
 * model. We inject a scripted fake "model" (the `modelProcessFunc` /
 * `modelResetFunc` pair NonRealTimeVAD normally builds from the ONNX
 * session) so tests get production-faithful frame-processor behavior
 * (speech-start/redemption/misfire timing) driven by a deterministic
 * per-window script instead of real audio content.
 */
import {
  FrameProcessor,
  NonRealTimeVAD,
  type FrameProcessorOptions,
} from "@ricky0123/vad-web";

const FAKE_VAD_FRAME_PROCESSOR_OPTIONS: FrameProcessorOptions = {
  positiveSpeechThreshold: 0.35,
  negativeSpeechThreshold: 0.25,
  minSpeechMs: 120,
  preSpeechPadMs: 300,
  redemptionMs: 200,
  submitUserSpeechOnPause: false,
};

/** Matches the Silero legacy model's fixed window size (see streamingVad.ts). */
export const FAKE_VAD_MODEL_FRAME_SAMPLES = 1536;
const MS_PER_FRAME = FAKE_VAD_MODEL_FRAME_SAMPLES / 16;

export type IsSpeechScript = (windowIndex: number) => boolean;

/**
 * Builds a real `FrameProcessor` wired to a scripted fake model. Each call
 * to `.process()` advances an internal window counter and asks
 * `isSpeechScript` whether that window should be classified as speech.
 */
export function createScriptedFrameProcessor(
  isSpeechScript: IsSpeechScript,
  options: FrameProcessorOptions = FAKE_VAD_FRAME_PROCESSOR_OPTIONS,
): FrameProcessor {
  let windowIndex = 0;
  const modelProcessFunc = async (_frame: Float32Array) => {
    const isSpeech = isSpeechScript(windowIndex) ? 1 : 0;
    windowIndex += 1;
    return { isSpeech, notSpeech: 1 - isSpeech };
  };
  const modelResetFunc = () => {
    windowIndex = 0;
  };

  const frameProcessor = new FrameProcessor(
    modelProcessFunc,
    modelResetFunc,
    options,
    MS_PER_FRAME,
  );
  frameProcessor.resume();
  return frameProcessor;
}

/**
 * Builds a real `NonRealTimeVAD` (bypassing `.new()`, which would fetch and
 * load a real ONNX model) wired to a scripted fake model, for exercising the
 * genuine post-hoc `.run()` generator in tests.
 */
export function createScriptedNonRealTimeVad(
  isSpeechScript: IsSpeechScript,
  options: FrameProcessorOptions = FAKE_VAD_FRAME_PROCESSOR_OPTIONS,
): NonRealTimeVAD {
  const frameProcessor = createScriptedFrameProcessor(isSpeechScript, options);
  return new NonRealTimeVAD(
    async () => new ArrayBuffer(0),
    {} as never,
    {
      ...options,
      modelURL: "fake://model",
      modelFetcher: async () => new ArrayBuffer(0),
    },
    frameProcessor,
  );
}
