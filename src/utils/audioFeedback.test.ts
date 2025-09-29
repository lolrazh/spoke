import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock static asset imports used by audioFeedback
vi.mock("/assets/toggle_on7.wav?url", () => ({ default: "on.wav" }));
vi.mock("/assets/toggle_off7.wav?url", () => ({
  default: "off.wav",
}));

describe("utils/audioFeedback", () => {
  const plays: string[] = [];
  const pauses: string[] = [];
  let AudioMock: any;
  const origAudio: any = (globalThis as any).Audio;

  beforeEach(async () => {
    vi.useFakeTimers();
    plays.length = 0;
    pauses.length = 0;

    // Stub Audio before importing the module under test
    AudioMock = class {
      src = "";
      volume = 1;
      preload = "auto";
      currentTime = 0;
      constructor(src: string) {
        this.src = src;
      }
      load() {}
      pause() {
        pauses.push(this.src);
      }
      play() {
        plays.push(this.src);
        return Promise.resolve();
      }
    };
    // @ts-ignore
    globalThis.Audio = AudioMock;
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    // @ts-ignore
    globalThis.Audio = origAudio;
  });

  it("plays on immediately and off after small delay", async () => {
    const mod = await import("./audioFeedback");
    mod.playToggleOn();
    mod.playToggleOff();

    // On plays immediately
    expect(plays).toEqual(["on.wav"]);

    // Advance to trigger off (100ms)
    vi.advanceTimersByTime(100);
    expect(plays).toEqual(["on.wav", "off.wav"]);
  });

  it("respects user preference to disable sounds", async () => {
    window.localStorage.setItem("sf.playSounds", "false");
    const mod = await import("./audioFeedback");
    mod.playToggleOn();
    mod.playToggleOff();
    vi.advanceTimersByTime(200);
    expect(plays).toEqual([]);
    expect(pauses).toEqual([]);
  });

  it("restarts the audio so repeated clicks do not overlap", async () => {
    const mod = await import("./audioFeedback");
    mod.playToggleOn();
    mod.playToggleOn();
    // First call pauses then plays, second call pauses then plays again
    expect(plays.length).toBe(2);
  });
});
