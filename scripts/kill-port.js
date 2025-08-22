#!/usr/bin/env node
// Kill any process listening on a given TCP port (default: 8787).
const { execSync } = require('child_process');

function killPids(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
  // Force-kill lingering ones after a short delay
  setTimeout(() => {
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }, 1500);
}

function main() {
  const port = Number(process.argv[2] || 8787);
  if (!Number.isFinite(port)) {
    console.error('Usage: node scripts/kill-port.js [port]');
    process.exit(1);
  }
  const platform = process.platform;
  try {
    let pids = [];
    if (platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const lines = out.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid && !pids.includes(pid)) pids.push(pid);
      }
      // Use taskkill for Windows
      if (pids.length) {
        execSync(`taskkill /F ${pids.map((p) => `/PID ${p}`).join(' ')}`, { stdio: 'inherit' });
      }
    } else {
      // macOS / Linux: use lsof to find listening PIDs on the port
      const out = execSync(`lsof -n -i tcp:${port} -sTCP:LISTEN -t || true`, { encoding: 'utf8' });
      pids = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));
      if (pids.length) {
        console.log(`Killing PIDs on port ${port}: ${pids.join(', ')}`);
        killPids(pids);
      } else {
        console.log(`No listeners found on port ${port}.`);
      }
    }
  } catch (e) {
    console.error('Failed to free port:', e.message);
    process.exit(1);
  }
}

main();

