import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";

type Message = { type: "level"; rms: number } | { type: "audio"; samples: Int16Array };
type Processor = { process: (inputs: Float32Array[][]) => boolean };

describe("capture worklet meter", () => {
  it("reports quiet speech before a transcription frame is ready, without changing PCM", () => {
    const messages: Message[] = [];
    let Worklet: new (options: object) => Processor;
    class AudioWorkletProcessor {
      port = { postMessage: (message: Message) => messages.push(message) };
    }
    const source = readFileSync(
      new NodeURL("../../public/worklets/pcm16-downsampler.worklet.js", import.meta.url),
      "utf8",
    );
    runInNewContext(source, {
      sampleRate: 16000,
      AudioWorkletProcessor,
      Float32Array,
      Int16Array,
      ArrayBuffer,
      registerProcessor: (_name: string, implementation: typeof Worklet) => {
        Worklet = implementation;
      },
    });
    const processor = new Worklet!({
      processorOptions: { targetSampleRate: 16000, frameSamples: 1536 },
    });
    processor.process([[new Float32Array(320).fill(0.01)]]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "level", rms: expect.closeTo(0.01, 6) });
    processor.process([[new Float32Array(1216).fill(0.01)]]);
    const frames = messages.filter((message) => message.type === "audio");
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0].samples)).toEqual(Array(1536).fill(327));
    expect(messages.filter((message) => message.type === "level")).toHaveLength(4);
  });
});
