import { spawn } from "child_process";
import type { BrowserWindow } from "electron";

const osaRaw = String.raw`
  use framework "Carbon"
  use scripting additions      -- required for “do shell script”

  property kCGEventFlagMaskSecondaryFn : 4194304 -- 1 << 22

  on fnIsDown()
    set flags to (current application's CGEventSourceFlagsState(0)) as integer
    return ((flags div kCGEventFlagMaskSecondaryFn) mod 2) = 1
  end fnIsDown

  set wasDown to false
  repeat
    set nowDown to fnIsDown()
    if nowDown and (wasDown is false) then
      do shell script "echo down"
    else if (not nowDown) and wasDown then
      do shell script "echo up"
    end if
    set wasDown to nowDown
    delay 0.016
  end repeat
`;

// strip the indentation so `use framework` starts in column 1
const osaScript = osaRaw
  .replace(/^\s*\n/, "")      // drop first newline
  .replace(/^\s+/gm, "");     // trim every line’s leading spaces

export function createFnListener(win: BrowserWindow) {
  console.log("[Fn] listener starting…");
  const child = spawn("osascript", ["-e", osaScript]);

  child.stdout.on("data", (d) => {
    const s = String(d).trim();
    if (s === "down") win.webContents.send("ptt-down");
    else if (s === "up") win.webContents.send("ptt-up");
  });

  child.stderr.on("data", (d) =>
    console.error("[Fn] osa-stderr:", String(d).trim())
  );
  child.on("error", (e) => console.error("[Fn] spawn error:", e));
  win.once("closed", () => child.kill());
}
