/// <reference lib="webworker" />

import { Message, NonRealTimeVAD } from "@ricky0123/vad-web";
import {
  VAD_INIT_TIMEOUT_MS,
  VAD_MIN_SPEECH_MS,
  VAD_NEGATIVE_SPEECH_THRESHOLD,
  VAD_POSITIVE_SPEECH_THRESHOLD,
  VAD_PRE_SPEECH_PAD_MS,
  VAD_REDEMPTION_MS,
} from "../config/vad";
import type {
  VadWorkerEvent,
  VadWorkerRequest,
  VadWorkerResponse,
  VadWorkerSegment,
} from "./vadWorkerProtocol";

type VadInstance = Awaited<ReturnType<typeof NonRealTimeVAD.new>>;

type FrameProcessorWithAudioBuffer = {
  audioBuffer?: Array<{ frame: Float32Array; isSpeech: boolean }>;
  reset(): void;
  resume(): void;
};

let vad: VadInstance | null = null;
let operationQueue: Promise<void> = Promise.resolve();

function post(response: VadWorkerResponse): void {
  self.postMessage(response);
}

// NonRealTimeVAD keeps every processed frame so it can return speech audio.
// StreamingVAD only consumes boundary events, so release those frame views
// after each model call while keeping the small isSpeech history intact.
let releasedAudioBuffer:
  | FrameProcessorWithAudioBuffer["audioBuffer"]
  | null = null;
let releasedAudioFrameCount = 0;

function releaseBufferedAudioFrames(): void {
  const frameProcessor = vad?.frameProcessor as unknown as
    | FrameProcessorWithAudioBuffer
    | undefined;
  const audioBuffer = frameProcessor?.audioBuffer;
  if (!audioBuffer) return;

  // FrameProcessor replaces audioBuffer when a segment ends, and may shift
  // its short pre-speech window while idle. Reset the cursor for either case.
  if (
    releasedAudioBuffer !== audioBuffer ||
    releasedAudioFrameCount > audioBuffer.length
  ) {
    releasedAudioBuffer = audioBuffer;
    releasedAudioFrameCount = 0;
  }

  for (let index = releasedAudioFrameCount; index < audioBuffer.length; index++) {
    audioBuffer[index].frame = EMPTY_AUDIO_FRAME;
  }
  releasedAudioFrameCount = audioBuffer.length;
}

const EMPTY_AUDIO_FRAME = new Float32Array(0);

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load VAD asset ${url}: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

async function initialize(
  modelUrl: string,
  wasmBaseUrl: string,
): Promise<void> {
  vad = await NonRealTimeVAD.new({
    modelURL: modelUrl,
    modelFetcher: fetchArrayBuffer,
    positiveSpeechThreshold: VAD_POSITIVE_SPEECH_THRESHOLD,
    negativeSpeechThreshold: VAD_NEGATIVE_SPEECH_THRESHOLD,
    minSpeechMs: VAD_MIN_SPEECH_MS,
    preSpeechPadMs: VAD_PRE_SPEECH_PAD_MS,
    redemptionMs: VAD_REDEMPTION_MS,
    submitUserSpeechOnPause: false,
    ortConfig: (ort) => {
      ort.env.logLevel = "error";
      ort.env.wasm.initTimeout = VAD_INIT_TIMEOUT_MS;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = wasmBaseUrl;
    },
  });
  const frameProcessor = vad.frameProcessor as unknown as {
    reset(): void;
    resume(): void;
  };
  frameProcessor.reset();
  frameProcessor.resume();
}

function boundaryEvent(
  message: Message,
  frameIndex: number,
): VadWorkerEvent | null {
  if (message === Message.SpeechStart) {
    return { type: "speech-start", frameIndex };
  }
  if (message === Message.SpeechEnd) {
    return { type: "speech-end", frameIndex };
  }
  if (message === Message.VADMisfire) {
    return { type: "misfire", frameIndex };
  }
  return null;
}

async function handle(request: VadWorkerRequest): Promise<void> {
  switch (request.type) {
    case "init":
      await initialize(request.modelUrl, request.wasmBaseUrl);
      post({ id: request.id, type: "result", result: undefined });
      return;
    case "process": {
      if (!vad) throw new Error("VAD worker is not initialized");
      const events: VadWorkerEvent[] = [];
      const frame = request.frame;
      await vad.frameProcessor.process(new Float32Array(frame), (event) => {
        const boundary = boundaryEvent(event.msg, request.frameIndex);
        if (boundary) events.push(boundary);
      });
      releaseBufferedAudioFrames();
      self.postMessage(
        {
          id: request.id,
          type: "result",
          result: { events, frame },
        },
        [frame],
      );
      return;
    }
    case "finish": {
      if (!vad) throw new Error("VAD worker is not initialized");
      const events: VadWorkerEvent[] = [];
      vad.frameProcessor.endSegment((event) => {
        const boundary = boundaryEvent(event.msg, request.frameIndex);
        if (boundary) events.push(boundary);
      });
      post({ id: request.id, type: "result", result: events });
      return;
    }
    case "run": {
      if (!vad) throw new Error("VAD worker is not initialized");
      const segments: VadWorkerSegment[] = [];
      for await (const segment of vad.run(
        new Float32Array(request.audio),
        request.sampleRateHz,
      )) {
        segments.push({ startMs: segment.start, endMs: segment.end });
      }
      post({ id: request.id, type: "result", result: segments });
    }
  }
}

self.onmessage = (event: MessageEvent<VadWorkerRequest>) => {
  const request = event.data;
  operationQueue = operationQueue.then(
    () => handle(request),
    () => handle(request),
  ).catch((error) => {
    post({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
