export class FakeAudioContext {
  sampleRate = 48000;
  audioWorklet = {
    addModule: async (_: string) => {},
  };
  createMediaStreamSource(_stream: MediaStream) {
    return {
      connect: (_node: unknown) => {},
      disconnect: () => {},
    } as unknown as AudioNode;
  }
  async close() {}
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
      },
    };
    // Expose last created for tests
    (globalThis as any).__lastWorklet = this;
  }

  connect() {}
  disconnect() {}
}
