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
});
