import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initMicDevicesBridge } from './micDevices';

describe('initMicDevicesBridge', () => {
  beforeEach(() => {
    // @ts-ignore
    global.navigator = global.navigator || {};
    // @ts-ignore
    navigator.mediaDevices = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      enumerateDevices: vi.fn(async () => []),
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: () => {} }] })),
    } as any;

    // Minimal mic bridge
    // @ts-ignore
    global.window = global.window || {};
    // @ts-ignore
    window.mic = {
      onSelectedChanged: (cb: (p: { id: string }) => void) => {
        // immediately invoke once to simulate broadcast
        try { cb({ id: 'default' }); } catch {}
        return () => {};
      },
    } as any;
  });

  it('attaches devicechange listener without throwing', () => {
    expect(() => initMicDevicesBridge('default')).not.toThrow();
    expect(navigator.mediaDevices.addEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
  });
});

