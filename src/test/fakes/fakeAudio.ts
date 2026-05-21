export class FakeAudioContext {
  sampleRate = 48000;
  state: AudioContextState = "running";
  audioWorklet = {
    addModule: async (_: string) => {},
  };
  createMediaStreamSource(_stream: MediaStream) {
    return {
      connect: (_node: unknown) => {},
      disconnect: () => {},
    } as unknown as AudioNode;
  }
  async close() {
    this.state = "closed";
  }
}

export class FakeAudioWorkletNode {
  port: {
    onmessage: ((ev: MessageEvent) => void) | null;
    postMessage: (msg: unknown) => void;
    posted: unknown[];
  };

  constructor(_ctx: AudioContext, _name: string, _opts: unknown) {
    const posted: unknown[] = [];
    this.port = {
      onmessage: null,
      posted,
      postMessage: (msg: unknown) => {
        posted.push(msg);
        if ((msg as { type?: string })?.type === "flush") {
          setTimeout(() => {
            this.port.onmessage?.({
              data: { type: "flushed", rate: 16000, seq: 0 },
            } as MessageEvent);
          }, 0);
        }
      },
    };
    // Expose last created for tests
    (globalThis as any).__lastWorklet = this;
  }

  connect() {}
  disconnect() {}

  emitAudio(samples: Int16Array, rate = 16000, seq = 0) {
    const copy = new Int16Array(samples);
    this.port.onmessage?.({
      data: {
        type: "audio",
        samples: copy.buffer,
        rate,
        seq,
      },
    } as MessageEvent);
  }
}
