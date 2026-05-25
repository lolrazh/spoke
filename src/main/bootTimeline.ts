import { performance } from "node:perf_hooks";

type BootTimelineDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

class BootTimeline {
  private enabled = false;
  private readonly startedAt = performance.now();
  private lastAt = this.startedAt;

  configure(options: { enabled: boolean }): void {
    this.enabled = options.enabled;
  }

  mark(label: string, details?: BootTimelineDetails): void {
    if (!this.enabled) return;

    const now = performance.now();
    const elapsedMs = Math.round(now - this.startedAt);
    const deltaMs = Math.round(now - this.lastAt);
    this.lastAt = now;

    const suffix = formatDetails(details);
    console.log(`[Boot] +${elapsedMs}ms (+${deltaMs}ms) ${label}${suffix}`);
  }

  measureSync<T>(label: string, fn: () => T): T {
    if (!this.enabled) return fn();

    const startedAt = performance.now();
    try {
      return fn();
    } finally {
      const durationMs = Math.round(performance.now() - startedAt);
      this.mark(`${label}:done`, { durationMs });
    }
  }
}

function formatDetails(details?: BootTimelineDetails): string {
  if (!details) return "";

  const entries = Object.entries(details).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return "";

  const body = entries
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return ` ${body}`;
}

export const bootTimeline = new BootTimeline();
