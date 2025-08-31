import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transcribeWav } from './groq';

describe('services/stt/groq.transcribeWav', () => {
  const apiKey = 'test-key';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts wav to groq and returns text + timings', async () => {
    const wav = new Uint8Array([1, 2, 3]);

    const jsonBody = { text: 'hello world' };
    const res = new Response(JSON.stringify(jsonBody), { status: 200, headers: { 'content-type': 'application/json' } });

    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(res as any);

    const t0 = Date.now();
    const result = await transcribeWav(wav, apiKey, { timeoutMs: 5000 });

    expect(result.text).toBe('hello world');
    expect(result.timings.startAt).toBeGreaterThanOrEqual(t0);
    expect(result.timings.bodyDoneAt).toBeGreaterThanOrEqual(result.timings.headersAt);

    // Verify fetch call
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/audio/transcriptions');
    expect((init as any).method).toBe('POST');
    expect((init as any).headers.Authorization).toBe(`Bearer ${apiKey}`);
    // Minimal body check
    const body = (init as any).body;
    expect(typeof body.append).toBe('function'); // FormData-like
  });

  it('propagates non-2xx as error', async () => {
    const wav = new Uint8Array([0]);
    const res = new Response('bad', { status: 500 });
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(res as any);
    await expect(transcribeWav(wav, apiKey, { timeoutMs: 1000 })).rejects.toThrow(/GROQ STT error/);
  });

  it('aborts on timeout', async () => {
    const wav = new Uint8Array([0]);
    // Simulate a never-resolving fetch by returning a Promise that never resolves until aborted
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation((_: any, init: any) => {
      return new Promise((_resolve, reject) => {
        const signal: AbortSignal = init.signal;
        const DomEx: any = (globalThis as any).DOMException;
        const err = DomEx ? new DomEx('Aborted', 'AbortError') : new Error('AbortError');
        if (signal.aborted) return reject(err);
        const onAbort = () => reject(err);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    });

    await expect(transcribeWav(wav, apiKey, { timeoutMs: 1 })).rejects.toThrow();
  });
});
