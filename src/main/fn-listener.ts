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

on fnIsDown(flags)
  return ((flags div kCGEventFlagMaskFn) mod 2) = 1
end fnIsDown

set wasDown to false
repeat
  set currentFlags to (current application's CGEventSourceFlagsState(0)) as integer
  log ("flags:" & currentFlags)

  set nowDown to fnIsDown(currentFlags)

  if nowDown and (wasDown is false) then
    do shell script "echo down"
  else if (not nowDown) and wasDown then
    do shell script "echo up"
  end if
  set wasDown to nowDown
  delay 0.016
end repeat`;

export function createFnListener(win: BrowserWindow) {
  console.log('[Fn] Starting listener with correct flag (256) and stderr logging...');
  const child = spawn('osascript', ['-e', fnKeyScript]);

  // Set encoding to handle buffer data correctly.
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', data => {
    const msg = data.trim();
    if (msg === 'down') {
        console.log('[Fn] PTT-DOWN detected via stdout.');
        win.webContents.send('ptt-down');
    }
    if (msg === 'up') {
        console.log('[Fn] PTT-UP detected via stdout.');
        win.webContents.send('ptt-up');
    }
  });

  let lastStderrLine = '';
  child.stderr.on('data', data => {
    // osascript 'log' command outputs to stderr.
    const lines = data.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    if (lastLine && lastLine !== lastStderrLine) {
        console.log(`[fn-listener stderr] ${lastLine}`);
        lastStderrLine = lastLine;
    }
  });

  child.on('error', e => console.error('[fn-listener] spawn error:', e));

  child.on('close', (code) => {
    if (code !== null) { // A null code means the process was killed, which is expected.
      console.log(`[fn-listener] process exited with code ${code}`);
    }
  });
  
  win.once('closed', () => {
    console.log('[Fn] Window closed, killing listener process.');
    child.kill();
  });
}
