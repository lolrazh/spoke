#!/usr/bin/env node
// Orchestrate dev: start worker (port 8787) and Electron; ensure worker is killed when Electron exits.
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

function waitForPort(port, host = '127.0.0.1', timeoutMs = 30000, intervalMs = 200) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.connect({ port, host });
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        socket.removeAllListeners();
        socket.destroy();
      };
      socket.once('connect', () => {
        cleanup();
        resolve();
      });
      socket.once('error', () => {
        cleanup();
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(tryConnect, intervalMs);
      });
    };
    tryConnect();
  });
}

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

let workerProc = null;
let forgeProc = null;
let shuttingDown = false;

function killTree(proc, signal = 'SIGINT') {
  if (!proc || proc.killed) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGKILL');
      } catch {}
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      proc.kill(signal);
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function cleanupAndExit(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([killTree(forgeProc), killTree(workerProc)]);
  process.exit(code);
}

async function main() {
  // 1) Start the worker (wrangler dev on 8787)
  const workerCwd = path.resolve(__dirname, '..', 'worker');
  workerProc = spawn(npmCmd, ['run', 'dev'], {
    cwd: workerCwd,
    stdio: 'inherit',
    env: process.env,
  });

  workerProc.on('exit', (code) => {
    // If worker dies early while Electron is still starting/running, exit everything.
    if (!shuttingDown) {
      console.error(`Worker exited with code ${code}. Shutting down dev environment.`);
      cleanupAndExit(code || 1);
    }
  });

  // 2) Wait until the worker is listening, then start Electron Forge
  try {
    await waitForPort(8787, '127.0.0.1', 30000, 200);
  } catch (err) {
    console.error(String(err));
    return cleanupAndExit(1);
  }

  forgeProc = spawn('electron-forge', ['start'], {
    stdio: 'inherit',
    env: { ...process.env, SF_DEVTOOLS: '1' },
  });

  forgeProc.on('exit', (code) => {
    // When Electron closes, stop the worker too.
    cleanupAndExit(code || 0);
  });

  // Propagate signals to ensure both processes are cleaned up.
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const sig of signals) {
    process.on(sig, () => cleanupAndExit(0));
  }
  process.on('uncaughtException', (e) => {
    console.error('Uncaught exception:', e);
    cleanupAndExit(1);
  });
  process.on('unhandledRejection', (e) => {
    console.error('Unhandled rejection:', e);
    cleanupAndExit(1);
  });
}

main();

