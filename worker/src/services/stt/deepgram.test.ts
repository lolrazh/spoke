import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEEPGRAM_STT_ENDPOINT, DEEPGRAM_STT_DEFAULT_MODEL } from '../../config';
import { transcribeWav } from './providers/deepgram';

describe('services/stt/deepgram.transcribeWav', () => {
  const apiKey = 'dg-key';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts wav to deepgram with default query params', async () => {
    const wav = new Uint8Array([1, 2, 3]);
    const jsonBody = {
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: 'fallback transcript',
                paragraphs: {
                  paragraphs: [
                    { transcript: 'hello' },
                    { transcript: 'world' },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
    const res = new Response(JSON.stringify(jsonBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(res as any);

    const result = await transcribeWav(wav, apiKey, { timeoutMs: 1000 });

    expect(result.text).toBe('hello world');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    const parsed = new URL(url as string);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(DEEPGRAM_STT_ENDPOINT);
    expect(parsed.searchParams.get('model')).toBe(DEEPGRAM_STT_DEFAULT_MODEL);
    expect(parsed.searchParams.get('language')).toBe('en');
    expect(parsed.searchParams.get('punctuate')).toBe('true');
    expect(parsed.searchParams.get('paragraphs')).toBe('true');
    const headers = (init as any).headers;
    expect(headers.Authorization).toBe(`Token ${apiKey}`);
    expect(headers['Content-Type']).toBe('audio/wav');
    expect(headers.Accept).toBe('application/json');
    expect((init as any).body).toBeInstanceOf(ArrayBuffer);
  });

  it('throws on non-ok response', async () => {
    const wav = new Uint8Array([4, 5, 6]);
    const res = new Response('nope', { status: 401 });
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(res as any);
    await expect(transcribeWav(wav, apiKey)).rejects.toThrow(/DEEPGRAM STT error/);
  });
});
