import { describe, it, expect } from 'vitest';
import { buildSessionSummary } from './summary';

describe('utils/summary.buildSessionSummary', () => {
  const env = { SENTRY_ENVIRONMENT: 'test', CF_VERSION_METADATA: { id: 'v123' } };

  it('computes stt-only pipeline with client+worker merge', () => {
    const body = {
      traceId: 'abc',
      client: { framesProduced: 10, bytesProduced: 2048 },
      worker: {
        frames: 12,
        bytes: 4096,
        seqGaps: 1,
        firstToLastArrivalMs: 500,
        stt: { totalMs: 250, ttfbMs: 120, bodyMs: 130, provider: 'groq' },
      },
      derived: { e2eMs: 900, captureMs: 150, deliverMs: 50, pasteMs: 25 },
    };
    const s = buildSessionSummary(body as any, env as any);
    expect(s.id).toBe('abc');
    expect(s.pipeline).toBe('stt');
    expect(s.durations.sttMs).toBe(250);
    expect(s.durations.sttTtfbMs).toBe(120);
    expect(s.durations.sttBodyMs).toBe(130);
    expect(s.traffic.bytesKB).toBe(Number((4096/1024).toFixed(2)));
    expect(s.env.environment).toBe('test');
    expect(s.env.release).toBe('v123');
    expect(s.shareTranscriptions).toBe(false);
  });

  it('computes stt+llm when llm present and wsAcceptToFinal delta', () => {
    const body = {
      traceId: 'abc2',
      worker: {
        llm: { totalMs: 100, ttfbMs: 40, bodyMs: 60, firstDeltaAt: 1100, startAt: 1000 },
        stt: { totalMs: 200, ttfbMs: 80, bodyMs: 120 },
        wsAcceptAt: 1000,
        finalSentAt: 1500,
      },
      derived: {},
    };
    const s = buildSessionSummary(body as any, env as any);
    expect(s.pipeline).toBe('stt+llm');
    expect(s.durations.llmMs).toBe(100);
    expect(s.durations.wsAcceptToFinalMs).toBe(500);
    expect(s.durations.serverProcessingMs).toBe(300);
    expect(s.durations.llmTtfbMs).toBe(40);
    expect(s.durations.llmBodyMs).toBe(60);
    expect(s.durations.llmFirstTokenMs).toBe(100);
  });

  it('computes edit pipeline when mode is edit', () => {
    const body = {
      traceId: 'abc3',
      worker: {
        mode: 'edit',
        llm: { totalMs: 100, ttfbMs: 40, bodyMs: 60, firstDeltaAt: 1100, startAt: 1000 },
        stt: { totalMs: 200, ttfbMs: 80, bodyMs: 120 },
        wsAcceptAt: 1000,
        finalSentAt: 1500,
      },
      derived: {},
    };
    const s = buildSessionSummary(body as any, env as any);
    expect(s.pipeline).toBe('edit');
    expect(s.durations.llmMs).toBe(100);
    expect(s.durations.wsAcceptToFinalMs).toBe(500);
    expect(s.durations.serverProcessingMs).toBe(300);
  });

  it('computes dictation pipeline when mode is dictation with llm', () => {
    const body = {
      traceId: 'abc5',
      worker: {
        mode: 'dictation',
        llm: { totalMs: 100, ttfbMs: 40, bodyMs: 60, firstDeltaAt: 1100, startAt: 1000 },
        stt: { totalMs: 200, ttfbMs: 80, bodyMs: 120 },
        wsAcceptAt: 1000,
        finalSentAt: 1500,
      },
      derived: {},
    };
    const s = buildSessionSummary(body as any, env as any);
    expect(s.pipeline).toBe('dictation');
    expect(s.durations.llmMs).toBe(100);
    expect(s.durations.wsAcceptToFinalMs).toBe(500);
    expect(s.durations.serverProcessingMs).toBe(300);
  });

  it('computes stt pipeline when no llm and mode is dictation', () => {
    const body = {
      traceId: 'abc4',
      worker: {
        mode: 'dictation',
        stt: { totalMs: 200, ttfbMs: 80, bodyMs: 120 },
        wsAcceptAt: 1000,
        finalSentAt: 1500,
      },
      derived: {},
    };
    const s = buildSessionSummary(body as any, env as any);
    expect(s.pipeline).toBe('stt');
    expect(s.durations.sttMs).toBe(200);
    expect(s.durations.wsAcceptToFinalMs).toBe(500);
  });

  it('omits dataset when share flag is false', () => {
    const body = {
      traceId: 'dataset-off',
      dataset: { sttText: 'secret', llmText: 'output' },
      shareTranscriptions: false,
    };
    const s = buildSessionSummary(body as any, env as any);
    expect(s.dataset).toBeNull();
    expect(s.shareTranscriptions).toBe(false);
  });

  it('retains dataset when share flag is true', () => {
    const body = {
      traceId: 'dataset-on',
      dataset: { sttText: 'hello', llmText: 'world' },
      shareTranscriptions: true,
    };
    const s = buildSessionSummary(body as any, env as any);
    expect(s.dataset?.sttText).toBe('hello');
    expect(s.dataset?.llmText).toBe('world');
    expect(s.shareTranscriptions).toBe(true);
  });
});
