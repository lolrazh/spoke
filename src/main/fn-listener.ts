// fn-listener.ts - Comprehensive debugging version
import { spawn } from 'child_process'
import type { BrowserWindow } from 'electron'
import { systemPreferences } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// First, let's try the simplest possible AppleScript that should work
const simpleTestScript = `use framework "Carbon"
use scripting additions
return "test"`;

const FN_MASK = 8388608; // 0x00800000 (NOT 256!)

// The AppleScript to run, using the user-confirmed flag value of 256
// and adding `log` for unbuffered stderr debugging as requested.
const fnKeyScript = String.raw`
use framework "Carbon"
use scripting additions

-- your Mac toggles bit 8 (decimal 256)
property kCGEventFlagMaskFn : 256

on fnIsDown()
  set flags to (current application's CGEventSourceFlagsState(0)) as integer
  return ((flags div kCGEventFlagMaskFn) mod 2) = 1
end fnIsDown

set wasDown to false
repeat
  set nowDown to fnIsDown()
  if nowDown and (wasDown is false) then
    log "down"
  else if (not nowDown) and wasDown then
    log "up"
  end if
  set wasDown to nowDown
  delay 0.016
end repeat`;

export function createFnListener(win: BrowserWindow) {
  console.log('[Fn] Starting listener. Reading ptt events from stderr...');
  const child = spawn('osascript', ['-e', fnKeyScript]);

  // We read from stderr because the AppleScript `log` command writes to it.
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    // A single chunk can contain multiple lines
    chunk.split(/\r?\n/).forEach((line: string) => {
      const msg = line.trim();
      if (msg === 'down') {
        console.log('[Fn] PTT-DOWN detected.');
        win.webContents.send('ptt-down');
      } else if (msg === 'up') {
        console.log('[Fn] PTT-UP detected.');
        win.webContents.send('ptt-up');
      }
    });
  });

  child.on('error', e => console.error('[fn-listener] spawn error:', e));

  child.on('close', (code) => {
    // A null code means the process was killed, which is expected on app close.
    if (code !== null) { 
      console.log(`[fn-listener] process exited with code ${code}`);
    }
  });
  
  win.once('closed', () => {
    console.log('[Fn] Window closed, killing listener process.');
    child.kill();
  });
}
