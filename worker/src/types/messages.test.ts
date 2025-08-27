import { describe, it, expect } from 'vitest';
import { parseClientMessage } from './messages';

describe('types/messages.parseClientMessage', () => {
  it('parses start with optional fields', () => {
    const msg = parseClientMessage({ type: 'start', version: 2, format: 'pcm16le', rate: 16000, traceId: 't1', language: 'en' });
    expect(msg).toEqual({ type: 'start', version: 2, format: 'pcm16le', rate: 16000, traceId: 't1', language: 'en' });
  });

  it('drops unexpected field types', () => {
    // rate is wrong type -> undefined; format invalid -> undefined
    const msg = parseClientMessage({ type: 'start', version: 2, format: 'flac', rate: 'bad', traceId: 123 });
    expect(msg).toEqual({ type: 'start', version: 2, format: undefined, rate: undefined, traceId: undefined, language: undefined });
  });

  it('parses end and cancel', () => {
    expect(parseClientMessage({ type: 'end' })).toEqual({ type: 'end' });
    expect(parseClientMessage({ type: 'cancel' })).toEqual({ type: 'cancel' });
  });

  it('returns null for invalid shapes', () => {
    expect(parseClientMessage({})).toBeNull();
    expect(parseClientMessage({ type: 'noop' })).toBeNull();
    expect(parseClientMessage(null as any)).toBeNull();
  });
});

