/**
 * Native macOS notifications.
 *
 * Since Electron 42 these go through UNUserNotificationCenter, which only
 * delivers for code-signed builds (unsigned builds emit `failed`) and asks
 * the user for authorization once per bundle ID.
 */
import { Notification } from "electron";

// Electron removes a delivered notification from Notification Center and
// drops its event handlers when the JS object is garbage collected, so keep
// a reference until it is clicked, closed, or fails. Bounded so an
// unattended session cannot grow the set without limit.
const MAX_RETAINED = 8;
const retained = new Set<Notification>();

function release(notification: Notification): void {
  retained.delete(notification);
}

function retain(notification: Notification): void {
  retained.add(notification);
  while (retained.size > MAX_RETAINED) {
    const oldest = retained.values().next().value;
    if (!oldest) break;
    retained.delete(oldest);
  }
}

/**
 * Electron creates its notification presenter lazily, and creating it is what
 * sends macOS the one-time authorization request. Doing that ahead of the
 * first real notification keeps it from being posted while the prompt is
 * still pending (macOS rejects requests until the user answers).
 */
export function primeNativeNotifications(): void {
  try {
    if (!Notification.isSupported()) {
      console.warn("[notify] native notifications are not supported");
    }
  } catch (error) {
    console.warn("[notify] failed to initialize native notifications:", error);
  }
}

export function showNativeNotification(body: string): void {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: "Spoke",
    body,
    silent: false,
  });
  retain(notification);
  notification.on("click", () => release(notification));
  notification.on("close", () => release(notification));
  notification.on("failed", (_event, error) => {
    release(notification);
    console.warn(`[notify] native notification failed: ${error}`);
  });
  notification.show();
}

/** Test-only view of how many notifications are currently retained. */
export function retainedNotificationCount(): number {
  return retained.size;
}
