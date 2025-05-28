// tiny wrapper that starts the correct helper script for the platform
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { app } from "electron";

export type AltState = "down" | "up";
let child: ChildProcessWithoutNullStreams | null = null;

export function startAltListener(cb: (state: AltState) => void) {
  if (child) return;                              // already running

  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  // Plain-text script bodies – no external files to ship.
  const pwsh = `
Add-Type -Namespace u -Name k -MemberDefinition '
 [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
' ;
$down = $false
while ($true){
  $now = ([u.k]::GetAsyncKeyState(0x12) -band 0x8000) -ne 0   # 0x12 = VK_MENU (Alt)
  if ($now -and -not $down){ Write-Output "down"; $down=$true }
  elseif (-not $now -and $down){ Write-Output "up"; $down=$false }
  Start-Sleep -Milliseconds 16
}`.trim();

  const osa = `
use framework "Carbon"
property kVK_Option : 0x3A
on isKeyDown()
  set mods to current application's NSScreen's mainScreen()'s \
          deviceDescription()'s objectForKey:"NSEventModifierFlags"
  return ((mods as integer) div 1048576 mod 2) = 1 -- option flag
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

  const bash = `
#!/usr/bin/env bash
down=0
while :; do
  read -rs -n1 -t0.016 k < /dev/input/by-path/*-kbd 2>/dev/null
  state=$?
  if [[ $state -eq 0 && $down -eq 0 ]]; then echo down; down=1
  elif [[ $state -ne 0 && $down -eq 1 ]]; then echo up; down=0; fi
done`.trim();

  if (isWin) {
    child = spawn("powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", pwsh]);
  } else if (isMac) {
    child = spawn("osascript", ["-e", osa]);
  } else { // linux
    child = spawn("bash", ["-c", bash]);
  }

  child.stdout.on("data", d => {
    const msg = String(d).trim();
    if (msg === "down" || msg === "up") cb(msg as AltState);
  });

  child.on("error", err => console.error("alt-listener error:", err));
  child.on("exit",  ()  => { child = null; });
}

export function stopAltListener() { child?.kill(); child = null; }
app.on("will-quit", stopAltListener); 