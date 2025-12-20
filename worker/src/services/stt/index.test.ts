import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SIMPLISMART_STT_MODEL, STT_DEFAULT_MODEL, STT_DEFAULT_PROVIDER } from '../../config';

vi.mock('./providers/groq', () => ({
  transcribeWav: vi.fn().mockResolvedValue({
    text: 'groq-text',
    timings: { startAt: 1, headersAt: 2, bodyDoneAt: 3 },
  }),
}));

vi.mock('./providers/fireworks', () => ({
  transcribeWav: vi.fn().mockResolvedValue({
    text: 'fireworks-text',
    timings: { startAt: 1, headersAt: 3, bodyDoneAt: 5 },
  }),
}));

vi.mock('./providers/deepgram', () => ({
  transcribeWav: vi.fn().mockResolvedValue({
    text: 'deepgram-text',
    timings: { startAt: 2, headersAt: 4, bodyDoneAt: 6 },
  }),
}));

vi.mock('./providers/simplismart', () => ({
  transcribeWav: vi.fn().mockResolvedValue({
    text: 'simplismart-text',
    timings: { startAt: 3, headersAt: 6, bodyDoneAt: 9 },
  }),
}));

import { transcribeWav } from '.';
import { transcribeWav as groqTranscribe } from './providers/groq';
import { transcribeWav as fireworksTranscribe } from './providers/fireworks';
import { transcribeWav as deepgramTranscribe } from './providers/deepgram';
import { transcribeWav as simplismartTranscribe } from './providers/simplismart';

const groqMock = vi.mocked(groqTranscribe);
const fireworksMock = vi.mocked(fireworksTranscribe);
const deepgramMock = vi.mocked(deepgramTranscribe);
const simplismartMock = vi.mocked(simplismartTranscribe);

describe('services/stt index transcribeWav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to the configured provider', async () => {
    const wav = new Uint8Array([0, 1]);
    const result = await transcribeWav(wav, { apiKey: 'default-key' });

    if (STT_DEFAULT_PROVIDER === 'groq') {
      expect(result.text).toBe('groq-text');
      expect(groqMock).toHaveBeenCalledTimes(1);
      expect(fireworksMock).not.toHaveBeenCalled();
      expect(deepgramMock).not.toHaveBeenCalled();
      expect(simplismartMock).not.toHaveBeenCalled();
      const [, , opts] = groqMock.mock.calls[0];
      expect(opts.model).toBe(STT_DEFAULT_MODEL);
      expect(opts.language).toBeTruthy();
    } else if (STT_DEFAULT_PROVIDER === 'fireworks') {
      expect(result.text).toBe('fireworks-text');
      expect(fireworksMock).toHaveBeenCalledTimes(1);
      expect(groqMock).not.toHaveBeenCalled();
      expect(deepgramMock).not.toHaveBeenCalled();
      expect(simplismartMock).not.toHaveBeenCalled();
    } else {
      if (STT_DEFAULT_PROVIDER === 'deepgram') {
        expect(result.text).toBe('deepgram-text');
        expect(deepgramMock).toHaveBeenCalledTimes(1);
        expect(groqMock).not.toHaveBeenCalled();
        expect(fireworksMock).not.toHaveBeenCalled();
        expect(simplismartMock).not.toHaveBeenCalled();
      } else {
        expect(result.text).toBe('simplismart-text');
        expect(simplismartMock).toHaveBeenCalledTimes(1);
        expect(groqMock).not.toHaveBeenCalled();
        expect(fireworksMock).not.toHaveBeenCalled();
        expect(deepgramMock).not.toHaveBeenCalled();
        const [, , opts] = simplismartMock.mock.calls[0];
        expect(opts.model).toBe(SIMPLISMART_STT_MODEL);
        expect(opts.language).toBeTruthy();
      }
    }
  });

  it('routes to fireworks provider when specified', async () => {
    const wav = new Uint8Array([2, 3]);
    const result = await transcribeWav(wav, { apiKey: 'fw-key', provider: 'fireworks', model: 'whisper-v3-turbo' });

    expect(result.text).toBe('fireworks-text');
    expect(fireworksMock).toHaveBeenCalledTimes(1);
    expect(groqMock).not.toHaveBeenCalled();
    expect(deepgramMock).not.toHaveBeenCalled();
    const [, , opts] = fireworksMock.mock.calls[0];
    expect(opts.model).toBe('whisper-v3-turbo');
  });

  it('routes to deepgram provider when specified', async () => {
    const wav = new Uint8Array([7, 8]);
    const result = await transcribeWav(wav, { apiKey: 'dg-key', provider: 'deepgram' });

    expect(result.text).toBe('deepgram-text');
    expect(deepgramMock).toHaveBeenCalledTimes(1);
    expect(groqMock).not.toHaveBeenCalled();
    expect(fireworksMock).not.toHaveBeenCalled();
    const [, , opts] = deepgramMock.mock.calls[0];
    expect(opts.model).toBeTruthy();
    expect(opts.language).toBeTruthy();
  });

  it('throws when apiKey missing', async () => {
    const wav = new Uint8Array([1]);
    await expect(transcribeWav(wav, { apiKey: '', provider: 'groq' })).rejects.toThrow(/Missing API key/);
  });
});
