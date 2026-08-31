import { useCallback, useRef, useEffect } from "react";
import { createLogger } from "../utils/logger";

const permissionsLog = createLogger("Permissions");

// Notification timing tokens
export const PERMISSION_NOTIFICATION_DURATION_MS = 6000;
export const PERMISSION_NOTIFICATION_REPEAT_DELAY_MS =
  PERMISSION_NOTIFICATION_DURATION_MS + 2000;
export const PERMISSION_NOTIFICATION_INTERACTION_DELAY_MS = 3500;

const PERMISSION_NOTIFICATION_MESSAGE =
  "Permissions required. Double click to review.";
export const PERMISSION_NOTIFICATION_ACTION_ID = "open-permissions";

const logPermissionsDebug = (...args: unknown[]) => {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("debugPerm")
  ) {
    permissionsLog.info(...args);
  }
};

type NotificationReason = "detected" | "repeat" | "changed" | "ptt" | "manual";

interface UsePermissionNotificationsOptions {
  missingPermissions: string[];
}

interface UsePermissionNotificationsReturn {
  triggerPermissionNotification: (
    reason: Exclude<NotificationReason, "repeat">,
    delay?: number,
  ) => void;
  schedulePermissionNotification: (delay: number) => void;
  clearPermissionNotificationLoop: () => void;
  isNotificationScheduled: () => boolean;
  missingCountRef: React.MutableRefObject<number>;
  missingSignatureRef: React.MutableRefObject<string>;
}

export function usePermissionNotifications({
  missingPermissions,
}: UsePermissionNotificationsOptions): UsePermissionNotificationsReturn {
  const permissionNotificationTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const missingSignatureRef = useRef<string>(
    [...missingPermissions].sort().join("|"),
  );
  const missingCountRef = useRef<number>(missingPermissions.length);

  // Stable callback - no dependencies, uses refs
  const clearPermissionNotificationLoop = useCallback(() => {
    if (permissionNotificationTimerRef.current) {
      clearTimeout(permissionNotificationTimerRef.current);
      permissionNotificationTimerRef.current = null;
    }
  }, []);

  // Stable callback - no dependencies, uses refs
  const sendPermissionNotification = useCallback(
    (reason: NotificationReason) => {
      logPermissionsDebug("notify:permissions", {
        reason,
        missing: missingSignatureRef.current,
      });
      try {
        window.notifications?.send?.(
          PERMISSION_NOTIFICATION_MESSAGE,
          PERMISSION_NOTIFICATION_ACTION_ID,
        );
      } catch {}
    },
    [],
  );

  // Schedule callback - uses stable refs, no cascading invalidation
  const schedulePermissionNotification = useCallback(
    (delay: number) => {
      // Clear inline to avoid dependency on clearPermissionNotificationLoop
      if (permissionNotificationTimerRef.current) {
        clearTimeout(permissionNotificationTimerRef.current);
        permissionNotificationTimerRef.current = null;
      }

      permissionNotificationTimerRef.current = setTimeout(
        () => {
          permissionNotificationTimerRef.current = null;
          if (missingCountRef.current > 0) {
            sendPermissionNotification("repeat");
            // Reschedule - use inline ref access
            schedulePermissionNotification(
              PERMISSION_NOTIFICATION_REPEAT_DELAY_MS,
            );
          }
        },
        Math.max(delay, 0),
      );
    },
    [sendPermissionNotification],
  );

  // Trigger callback - stable with minimal dependencies
  const triggerPermissionNotification = useCallback(
    (reason: Exclude<NotificationReason, "repeat">, delay?: number) => {
      sendPermissionNotification(reason);
      schedulePermissionNotification(
        delay ?? PERMISSION_NOTIFICATION_REPEAT_DELAY_MS,
      );
    },
    [schedulePermissionNotification, sendPermissionNotification],
  );

  // Check if a notification timer is currently scheduled
  const isNotificationScheduled = useCallback(() => {
    return permissionNotificationTimerRef.current !== null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (permissionNotificationTimerRef.current) {
        clearTimeout(permissionNotificationTimerRef.current);
      }
    };
  }, []);

  return {
    triggerPermissionNotification,
    schedulePermissionNotification,
    clearPermissionNotificationLoop,
    isNotificationScheduled,
    missingCountRef,
    missingSignatureRef,
  };
}
