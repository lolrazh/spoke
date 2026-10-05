/**
 * Idle auto-install
 *
 * Once an update is downloaded, install it while the user is away instead of
 * waiting for them to click Restart: after 10 minutes without any input, or
 * once the screen has been locked for a minute. Never while Spoke is
 * recording, transcribing, or installing a model. The ready dot in the menu
 * bar stays as the fallback, and each version gets one automatic attempt so a
 * failed handoff cannot turn into a restart loop.
 *
 * A dictation is capped at five minutes and starts with a key press, so the
 * 10-minute idle bar alone already rules out restarting mid-dictation. The
 * busy check covers the lock case: a transcription or paste still finishing
 * right after the user locks the screen.
 */

export const IDLE_INSTALL_POLL_MS = 60_000;
export const IDLE_INSTALL_AFTER_S = 10 * 60;
export const LOCKED_INSTALL_AFTER_S = 60;

export interface IdleInstallDeps {
  // Seconds since the last keyboard or mouse input.
  idleSeconds: () => number;
  isScreenLocked: () => boolean;
  isBusy: () => boolean;
  install: () => void;
}

export interface IdleInstaller {
  update(snapshot: { readyToInstall: boolean; version: string | null }): void;
  dispose(): void;
}

export function createIdleInstaller(deps: IdleInstallDeps): IdleInstaller {
  let timer: NodeJS.Timeout | null = null;
  let readyVersion: string | null = null;
  let attemptedVersion: string | null = null;

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function tick() {
    if (!readyVersion || attemptedVersion === readyVersion) {
      stop();
      return;
    }
    const idle = deps.idleSeconds();
    const due =
      idle >= IDLE_INSTALL_AFTER_S ||
      (idle >= LOCKED_INSTALL_AFTER_S && deps.isScreenLocked());
    if (!due || deps.isBusy()) return;

    attemptedVersion = readyVersion;
    stop();
    console.log(
      `[Updater] Installing ${readyVersion} while idle (${Math.round(idle)}s without input)`,
    );
    deps.install();
  }

  return {
    update(snapshot) {
      readyVersion = snapshot.readyToInstall
        ? (snapshot.version ?? "unknown")
        : null;
      if (!readyVersion || attemptedVersion === readyVersion) {
        stop();
        return;
      }
      if (timer) return;
      timer = setInterval(tick, IDLE_INSTALL_POLL_MS);
      // Must not keep the process alive at quit.
      timer.unref?.();
    },
    dispose: stop,
  };
}
