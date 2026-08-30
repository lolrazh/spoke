import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
} from "react";
import {
  usePermissions,
  type PermissionUiState,
  type PermissionsState,
} from "../hooks/usePermissions";
import { ENABLE_SCREEN_CONTEXT } from "../config/featureFlags";

export type MissingPermission = keyof PermissionsState;

type PermissionsControllerContext = {
  permissions: PermissionsState;
  ui: PermissionUiState;
  init: () => Promise<void>;
  requestMicrophone: () => Promise<void>;
  requestScreenRecording: () => Promise<void>;
  requestAccessibility: () => Promise<void>;
  requestInputMonitoring: () => Promise<void>;
  missingPermissions: MissingPermission[];
  permissionsLoaded: boolean;
};

const PermissionsContext = createContext<PermissionsControllerContext | null>(
  null,
);
const MissingPermissionsContext = createContext<MissingPermission[] | null>(
  null,
);

export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    permissions,
    ui,
    loaded: permissionsLoaded,
    init: initPermissions,
    requestMicrophone,
    requestScreenRecording,
    requestAccessibility,
    requestInputMonitoring,
  } = usePermissions(undefined, {
    pollIntervalMs: 1000,
    includeScreenRecording: ENABLE_SCREEN_CONTEXT,
  });

  useEffect(() => {
    const runInit = async () => {
      try {
        window.electron?.bootMark?.("permissions:init:start");
        await initPermissions();
        window.electron?.bootMark?.("permissions:init:done");
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
      permissionsLoaded,
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
      permissionsLoaded,
    ],
  );

  return (
    <MissingPermissionsContext.Provider value={missingPermissions}>
      <PermissionsContext.Provider value={contextValue}>
        {children}
      </PermissionsContext.Provider>
    </MissingPermissionsContext.Provider>
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

export function useMissingPermissions(): MissingPermission[] {
  const ctx = useContext(MissingPermissionsContext);
  if (!ctx) {
    throw new Error(
      "useMissingPermissions must be used within a PermissionsProvider",
    );
  }
  return ctx;
}
