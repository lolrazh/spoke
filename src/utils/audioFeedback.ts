// src/utils/audioFeedback.ts
// lightweight HTMLAudioElement wrapper – no external libs

// eslint-disable-next-line import/no-unresolved
import toggleOnUrl from "/assets/sonic-flow-toggle-on.wav?url";
// eslint-disable-next-line import/no-unresolved
import toggleOffUrl from "/assets/sonic-flow-toggle-off.wav?url";

const audioOn = new Audio(toggleOnUrl);
const audioOff = new Audio(toggleOffUrl);

audioOn.volume = 0.3;
audioOff.volume = 0.2;

// prep — reduce latency between .play() call and first sample
[audioOn, audioOff].forEach((a) => {
  a.preload = "auto";
  a.load();
});

// small utility so repeated clicks don't overlap the tail
function play(el: HTMLAudioElement) {
  el.pause();
  el.currentTime = 0;
  // play() returns a promise – ignore rejection from rapid user spam
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  el.play().catch(() => {});
}

export const playToggleOn = () => setTimeout(() => play(audioOn), 25);
export const playToggleOff = () => setTimeout(() => play(audioOff), 100);