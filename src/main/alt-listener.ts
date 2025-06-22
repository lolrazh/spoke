// macOS right-Alt key listener using AppleScript
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { app } from "electron";

export type AltState = "down" | "up";
let child: ChildProcessWithoutNullStreams | null = null;

export function startAltListener(cb: (state: AltState) => void) {
  if (child) return; // already running

  // macOS AppleScript for right-Alt key detection
  const osa = `
use framework "Carbon"
property kVK_Option_R : 61
on isKeyDown()
  return (current application's CGEventSourceKeyState(0, 61)) as boolean
end isKeyDown
set down to false
repeat
  set now to isKeyDown()
  if now and (down is false) then
    do shell script "echo down"
  else if (not now) and down then
    do shell script "echo up"
  end if
  set down to now
  delay 0.016
end repeat`.trim();

  child = spawn("osascript", ["-e", osa]);

  child.stdout.on("data", d => {
    const msg = String(d).trim();
    if (msg === "down" || msg === "up") cb(msg as AltState);
  });

  child.on("error", err => console.error("alt-listener error:", err));
  child.on("exit", () => { child = null; });
}

export function stopAltListener() { 
  child?.kill(); 
  child = null; 
}

app.on("will-quit", stopAltListener); 