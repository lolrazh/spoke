import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from './logger';

describe('logger', () => {
  const orig = { info: console.info, warn: console.warn, error: console.error };

  beforeEach(() => {
    console.info = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.info = orig.info;
    console.warn = orig.warn;
    console.error = orig.error;
  });

  it('prefixes messages with scope', () => {
    const log = createLogger('TestScope');
    log.info('hello');
    log.warn('warned');
    log.error('failed');

    expect(console.info).toHaveBeenCalledWith('[TestScope]', 'hello');
    expect(console.warn).toHaveBeenCalledWith('[TestScope]', 'warned');
    expect(console.error).toHaveBeenCalledWith('[TestScope]', 'failed');
  });
});

