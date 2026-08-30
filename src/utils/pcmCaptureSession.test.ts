import { describe, expect, it, vi } from "vitest";
import { PcmCaptureSession } from "./pcmCaptureSession";

type TestSession = {
  handleWorkletMessage: (message: unknown) => void;
  workletNode: { port: { postMessage: ReturnType<typeof vi.fn> } } | null;
};

describe("PcmCaptureSession", () => {
  it("returns an unretained full worklet frame for reuse", () => {
    const onPcmFrame = vi.fn();
    const postMessage = vi.fn();
    const session = new PcmCaptureSession({
      retainPcm: false,
      recyclePcmFrames: true,
      onPcmFrame,
    });
    const testSession = session as unknown as TestSession;
    testSession.workletNode = { port: { postMessage } };
    const samples = new Int16Array([1, -2, 3]);

    testSession.handleWorkletMessage({
      type: "audio",
      samples,
      rate: 16_000,
      seq: 0,
    });

    expect(onPcmFrame).toHaveBeenCalledWith(expect.any(Int16Array));
    expect(Array.from(onPcmFrame.mock.calls[0][0])).toEqual([1, -2, 3]);
    expect(postMessage).toHaveBeenCalledWith(
      { type: "recycle", samples: samples.buffer },
      [samples.buffer],
    );
  });

  it("returns retained frames after copying them into the recording", () => {
    const postMessage = vi.fn();
    const session = new PcmCaptureSession({
      retainPcm: true,
      recyclePcmFrames: true,
    });
    const testSession = session as unknown as TestSession;
    testSession.workletNode = { port: { postMessage } };
    const samples = new Int16Array([1, -2, 3]);

    testSession.handleWorkletMessage({
      type: "audio",
      samples,
      rate: 16_000,
      seq: 0,
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: "recycle", samples: samples.buffer },
      [samples.buffer],
    );

    const retainedPcm = (
      session as unknown as { retainedPcm: { take: () => Int16Array } }
    ).retainedPcm;
    expect(Array.from(retainedPcm.take())).toEqual([1, -2, 3]);
  });

  it("ignores queued worklet frames after cancellation", () => {
    const onPcmFrame = vi.fn();
    const postMessage = vi.fn();
    const session = new PcmCaptureSession({
      retainPcm: true,
      recyclePcmFrames: true,
      onPcmFrame,
    });
    const testSession = session as unknown as TestSession;
    testSession.workletNode = { port: { postMessage } };

    session.cancel();
    testSession.handleWorkletMessage({
      type: "audio",
      samples: new Int16Array([1, 2, 3]),
    });

    expect(onPcmFrame).not.toHaveBeenCalled();
    const retainedPcm = (
      session as unknown as { retainedPcm: { take: () => Int16Array } }
    ).retainedPcm;
    expect(retainedPcm.take()).toHaveLength(0);
  });
});
