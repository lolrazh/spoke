// WebSocket protocol types for streaming transcription (v2)

import type { SelectionRange } from "./shared";

export type ClientStartV1 = {
  type: "start";
  language?: string;
};

export type SelectionSnapshotPayload = {
  status?: string;
  hadSelection?: boolean;
  text?: string | null;
  range?: SelectionRange | null;
  valueLength?: number | null;
  source?: "ax" | "clipboard" | "none";
};

export type ClientSessionMode = "dictation" | "edit";

export type ClientIdentityPayload = {
  name?: string;
  email?: string;
};

export type ClientStartV2 = {
  type: "start";
  version: 2;
  format: "pcm16le";
  rate: number; // 16000
  language?: string;
  traceId?: string;
  mode?: ClientSessionMode;
  selection?: SelectionSnapshotPayload | null;
  identity?: ClientIdentityPayload;
};

export type ClientEnd = { type: "end" };
export type ClientCancel = { type: "cancel" };

/** Signals that the preceding audio frames form a complete chunk ready for STT */
export type ClientChunk = {
  type: "chunk";
  chunkIndex: number;
  /** Total audio duration in this chunk (ms) */
  audioMs: number;
};

export type ClientMsg =
  | ClientStartV1
  | ClientStartV2
  | ClientEnd
  | ClientCancel
  | ClientChunk;

export type ServerStatus = { type: "status"; state: "processing" | "queued" };
export type ServerFinal = { type: "final"; text: string; segments?: unknown[] };
export type ServerError = { type: "error"; body?: string };

/** Server response when a chunk has been transcribed */
export type ServerChunkResult = {
  type: "chunk_result";
  chunkIndex: number;
  text: string;
  traceId?: string;
};

export type ServerMsg =
  | ServerStatus
  | ServerFinal
  | ServerError
  | ServerChunkResult;

// Per-frame binary header (little-endian)
// u32 seq | u32 nbytes | u64 client_ts_ns
export const FRAME_HEADER_BYTES = 4 + 4 + 8; // 16 bytes
