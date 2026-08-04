import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/run-command.mjs <command> [args...]");
  process.exit(64);
}

const child = spawn(command, args, {
  env: process.env,
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(`[run-command] Failed to start ${command}:`, error);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
