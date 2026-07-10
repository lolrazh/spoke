// src/utils/audioFeedback.ts
// lightweight HTMLAudioElement wrapper – no external libs

// eslint-disable-next-line import/no-unresolved
import toggleOnUrl from "/assets/toggle_on7.wav?url";
// eslint-disable-next-line import/no-unresolved
import toggleOffUrl from "/assets/toggle_off7.wav?url";

// Construct the audio elements lazily on first play rather than at module
// import, so importing this module never touches the Audio API or kicks off a
// decode for sounds that may never play.
let audioOn: HTMLAudioElement | null = null;
let audioOff: HTMLAudioElement | null = null;

function createAudio(url: string): HTMLAudioElement {
  const a = new Audio(url);
  // Increase default volume for clearer audible feedback
  a.volume = 0.3;
  // prep — reduce latency between .play() call and first sample
  a.preload = "auto";
  a.load();
  return a;
}

function getAudioOn(): HTMLAudioElement {
  return (audioOn ??= createAudio(toggleOnUrl));
}

function getAudioOff(): HTMLAudioElement {
  return (audioOff ??= createAudio(toggleOffUrl));
}

function isPlaySoundsEnabled(): boolean {
  try {
    const stored = localStorage.getItem("sf.playSounds");
    // Default to true if not set
    return stored == null ? true : stored === "true";
  } catch {
    return true;
  }
}

// small utility so repeated clicks don't overlap the tail
function play(getEl: () => HTMLAudioElement) {
  // Respect user preference to disable sounds (checked before constructing the
  // element, so disabled sounds never allocate an Audio object)
  if (!isPlaySoundsEnabled()) return;
  const el = getEl();
  el.pause();
  el.currentTime = 0;
  // play() returns a promise – ignore rejection from rapid user spam
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  el.play().catch(() => {});
}

export const playToggleOn = () => play(getAudioOn);
export const playToggleOff = () => setTimeout(() => play(getAudioOff), 100);
