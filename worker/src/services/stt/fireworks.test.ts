import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIREWORKS_STT_TURBO_ENDPOINT } from '../../config';
import { transcribeWav } from './providers/fireworks';

describe('services/stt/fireworks.transcribeWav', () => {
  const apiKey = 'fw-key';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts wav to fireworks using API key header', async () => {
    const wav = new Uint8Array([4, 5, 6]);
    const jsonBody = { text: 'fireworks text' };
    const res = new Response(JSON.stringify(jsonBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(res as any);

    const result = await transcribeWav(wav, apiKey, { timeoutMs: 1000 });

    expect(result.text).toBe('fireworks text');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(FIREWORKS_STT_TURBO_ENDPOINT);
    expect((init as any).headers.Authorization).toBe(apiKey);
    const body = (init as any).body;
    expect(typeof body.append).toBe('function');
  });

  it('throws on non-ok response', async () => {
    const wav = new Uint8Array([1]);
    const res = new Response('nope', { status: 400 });
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(res as any);
    await expect(transcribeWav(wav, apiKey)).rejects.toThrow(/FIREWORKS STT error/);
  });
});
