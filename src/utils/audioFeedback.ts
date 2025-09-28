// src/utils/audioFeedback.ts
// lightweight HTMLAudioElement wrapper – no external libs

// eslint-disable-next-line import/no-unresolved
import toggleOnUrl from "/assets/toggle_on_bouncy_fast.wav?url";
// eslint-disable-next-line import/no-unresolved
import toggleOffUrl from "/assets/toggle_off_bouncy_fast.wav?url";

const audioOn = new Audio(toggleOnUrl);
const audioOff = new Audio(toggleOffUrl);

// Increase default volumes for clearer audible feedback
audioOn.volume = 0.6;
audioOff.volume = 0.6;

// prep — reduce latency between .play() call and first sample
[audioOn, audioOff].forEach((a) => {
  a.preload = "auto";
  a.load();
});

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
function play(el: HTMLAudioElement) {
  // Respect user preference to disable sounds
  if (!isPlaySoundsEnabled()) return;
  el.pause();
  el.currentTime = 0;
  // play() returns a promise – ignore rejection from rapid user spam
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  el.play().catch(() => {});
}

export const playToggleOn = () => play(audioOn);
export const playToggleOff = () => setTimeout(() => play(audioOff), 100);
