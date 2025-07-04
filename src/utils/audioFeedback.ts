// src/utils/audioFeedback.ts
// lightweight HTMLAudioElement wrapper – no external libs

import toggleOnUrl  from "/assets/sonic-flow-toggle-on.wav?url";
import toggleOffUrl from "/assets/sonic-flow-toggle-off.wav?url";

const audioOn  = new Audio(toggleOnUrl);
const audioOff = new Audio(toggleOffUrl);

audioOn.volume = 0.2;
audioOff.volume = 0.1;

// prep — reduce latency between .play() call and first sample
[audioOn, audioOff].forEach(a => { a.preload = "auto"; a.load(); });

// small utility so repeated clicks don't overlap the tail
function play(el: HTMLAudioElement) {
  el.pause();
  el.currentTime = 0;
  // play() returns a promise – ignore rejection from rapid user spam
  el.play().catch(() => {});
}

export const playToggleOn = () => setTimeout(() => play(audioOn), 60);
export const playToggleOff = () => setTimeout(() => play(audioOff), 100); 