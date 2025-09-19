import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { transcribeWav } from '.';
import { transcribeWav as groqTranscribe } from './providers/groq';
import { transcribeWav as fireworksTranscribe } from './providers/fireworks';

const groqMock = vi.mocked(groqTranscribe);
const fireworksMock = vi.mocked(fireworksTranscribe);

describe('services/stt index transcribeWav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to groq provider', async () => {
    const wav = new Uint8Array([0, 1]);
    const result = await transcribeWav(wav, { apiKey: 'groq-key' });

    expect(result.text).toBe('groq-text');
    expect(groqMock).toHaveBeenCalledTimes(1);
    expect(fireworksMock).not.toHaveBeenCalled();
    const [, , opts] = groqMock.mock.calls[0];
    expect(opts.model).toBeTruthy();
    expect(opts.language).toBeTruthy();
  });

  it('routes to fireworks provider when specified', async () => {
    const wav = new Uint8Array([2, 3]);
    const result = await transcribeWav(wav, { apiKey: 'fw-key', provider: 'fireworks', model: 'whisper-v3-turbo' });

    expect(result.text).toBe('fireworks-text');
    expect(fireworksMock).toHaveBeenCalledTimes(1);
    expect(groqMock).not.toHaveBeenCalled();
    const [, , opts] = fireworksMock.mock.calls[0];
    expect(opts.model).toBe('whisper-v3-turbo');
  });

  it('throws when apiKey missing', async () => {
    const wav = new Uint8Array([1]);
    await expect(transcribeWav(wav, { apiKey: '', provider: 'groq' })).rejects.toThrow(/Missing API key/);
  });
});
