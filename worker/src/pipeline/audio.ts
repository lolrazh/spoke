import { parseFrameHeader } from "../audio/codec";
import { safeClose } from "../utils/ws";
import type { ConnectionContext } from "./types";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export interface AudioFrameResult {
  success: boolean;
  error?: string;
}

/**
 * Handles binary audio frame
 * - Parses 16-byte header
 * - Validates sequence
 * - Accumulates payload
 * - Enforces size limit
 */
export function handleAudioFrame(
  ctx: ConnectionContext,
  data: ArrayBuffer,
): AudioFrameResult {
  const buf = new Uint8Array(data);

  if (buf.byteLength < 16) {
    return { success: false, error: "frame too small" };
  }

  const { seq, nbytes } = parseFrameHeader(buf);

  if (16 + nbytes > buf.byteLength) {
    return { success: false, error: "payload size mismatch" };
  }

  const payload = buf.subarray(16, 16 + nbytes);
  const now = Date.now();

  if (ctx.session.firstArrivalMs === null) {
    ctx.session.firstArrivalMs = now;
    ctx.timing.firstFrameAt = now;
  }
  ctx.session.lastArrivalMs = now;
  ctx.timing.lastFrameAt = now;

  if (ctx.session.lastSeq !== null && seq !== ctx.session.lastSeq + 1) {
    ctx.session.seqGaps += 1;
  }
  ctx.session.lastSeq = seq;

  if (ctx.session.totalBytes + payload.byteLength > MAX_AUDIO_BYTES) {
    ctx.server.send(
      JSON.stringify({
        type: "error",
        code: 4003,
        body: "audio too large",
        retryable: false,
      }),
    );
    safeClose(ctx.server, 1009, "payload too large");
    return { success: false, error: "audio too large" };
  }

  ctx.session.chunks.push(payload);
  ctx.session.totalBytes += payload.byteLength;
  ctx.session.frames += 1;

  return { success: true };
}
