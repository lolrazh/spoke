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
};

export type ClientSessionMode = "dictation" | "edit";

export type ClientStartV2 = {
  type: "start";
  version: 2;
  format: "pcm16le";
  rate: number; // 16000
  language?: string;
  traceId?: string;
  mode?: ClientSessionMode;
  selection?: SelectionSnapshotPayload | null;
};

export type ClientEnd = { type: "end" };
export type ClientCancel = { type: "cancel" };

export type ClientMsg =
  | ClientStartV1
  | ClientStartV2
  | ClientEnd
  | ClientCancel;

export type ServerStatus = { type: "status"; state: "processing" | "queued" };
export type ServerFinal = { type: "final"; text: string; segments?: unknown[] };
export type ServerError = { type: "error"; body?: string };

export type ServerMsg = ServerStatus | ServerFinal | ServerError;

// Per-frame binary header (little-endian)
// u32 seq | u32 nbytes | u64 client_ts_ns
export const FRAME_HEADER_BYTES = 4 + 4 + 8; // 16 bytes
