import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  usePermissions,
  type PermissionUiState,
  type PermissionsState,
} from "../hooks/usePermissions";
import { ENABLE_SCREEN_CONTEXT } from "../config/featureFlags";

type MissingPermission = keyof PermissionsState;

type PermissionsControllerContext = {
  permissions: PermissionsState;
  ui: PermissionUiState;
  init: () => Promise<void>;
  requestMicrophone: () => Promise<void>;
  requestScreenRecording: () => Promise<void>;
  requestAccessibility: () => Promise<void>;
  requestInputMonitoring: () => Promise<void>;
  missingPermissions: MissingPermission[];
  lastSnapshotAt: number | null;
};

const PermissionsContext = createContext<PermissionsControllerContext | null>(
  null,
);

export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    permissions,
    ui,
    init: initPermissions,
    requestMicrophone,
    requestScreenRecording,
    requestAccessibility,
    requestInputMonitoring,
  } = usePermissions(undefined, {
    pollIntervalMs: 1000,
    deepLinkGraceMs: 4000,
    includeScreenRecording: ENABLE_SCREEN_CONTEXT,
  });

  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null);
  const lastPermissionsRef = useRef<PermissionsState | null>(null);

  useEffect(() => {
    const runInit = async () => {
      try {
        await initPermissions();
      } catch {
        // ignore init failures; hook will retry on next focus/visibility event
      }
    };

    runInit();
    const handleFocus = () => {
      runInit();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        runInit();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    const previous = lastPermissionsRef.current;
    if (!previous) {
      setLastSnapshotAt(Date.now());
      lastPermissionsRef.current = permissions;
      return;
    }
    if (
      previous.microphone !== permissions.microphone ||
      previous.screenRecording !== permissions.screenRecording ||
      previous.inputMonitoring !== permissions.inputMonitoring ||
      previous.accessibility !== permissions.accessibility
    ) {
      setLastSnapshotAt(Date.now());
    }
    lastPermissionsRef.current = permissions;
  }, [permissions]);

  const missingPermissions = useMemo<MissingPermission[]>(() => {
    const missing: MissingPermission[] = [];
    if (!permissions.microphone) missing.push("microphone");
    if (ENABLE_SCREEN_CONTEXT && !permissions.screenRecording) {
      missing.push("screenRecording");
    }
    if (!permissions.inputMonitoring) missing.push("inputMonitoring");
    if (!permissions.accessibility) missing.push("accessibility");
    return missing;
  }, [permissions]);

  const contextValue = useMemo<PermissionsControllerContext>(
    () => ({
      permissions,
      ui,
      init: initPermissions,
      requestMicrophone,
      requestScreenRecording,
      requestAccessibility,
      requestInputMonitoring,
      missingPermissions,
      lastSnapshotAt,
    }),
    [
      permissions,
      ui,
      initPermissions,
      requestMicrophone,
      requestScreenRecording,
      requestAccessibility,
      requestInputMonitoring,
      missingPermissions,
      lastSnapshotAt,
    ],
  );

  return (
    <PermissionsContext.Provider value={contextValue}>
      {children}
    </PermissionsContext.Provider>
  );
};

export function usePermissionsController(): PermissionsControllerContext {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error(
      "usePermissionsController must be used within a PermissionsProvider",
    );
  }
  return ctx;
}
