import { encodeWAV } from "../utils/wav";

self.onmessage = (event: MessageEvent<{ audioData: Float32Array, sampleRate: number }>) => {
  const { audioData, sampleRate } = event.data;
  const wavBuffer = encodeWAV(audioData, sampleRate);
  (self as unknown as Worker).postMessage({ wavBuffer }, [wavBuffer]);
}; 