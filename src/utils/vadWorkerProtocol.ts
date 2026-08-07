export type VadWorkerEventType = "speech-start" | "speech-end" | "misfire";

export interface VadWorkerEvent {
  type: VadWorkerEventType;
  frameIndex: number;
}

export interface VadWorkerSegment {
  startMs: number;
  endMs: number;
}

export type VadWorkerRequest =
  | {
      id: number;
      type: "init";
      modelUrl: string;
      wasmBaseUrl: string;
    }
  | {
      id: number;
      type: "process";
      frameIndex: number;
      frame: ArrayBuffer;
    }
  | {
      id: number;
      type: "finish";
      frameIndex: number;
    }
  | {
      id: number;
      type: "run";
      audio: ArrayBuffer;
      sampleRateHz: number;
    };

export type VadWorkerResult =
  | undefined
  | VadWorkerEvent[]
  | VadWorkerSegment[];

export type VadWorkerResponse =
  | { id: number; type: "result"; result: VadWorkerResult }
  | { id: number; type: "error"; message: string };
