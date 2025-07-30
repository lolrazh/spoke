/**
 * TypeScript declarations for the Electron API exposed to the renderer process
 */

declare global {
  interface Window {
    app: {
      toggleDictation: (callback: () => void) => () => void;
      viewLogFile: () => Promise<string>;
    };
    contextMenu: {
      showPill: () => void;
    };
    transcript: {
      update: (text: string) => void;
    };
    clipboard: {
      insertText: (
        text: string,
      ) => Promise<{ success: boolean; error?: string }>;
    };
    notifications: {
      send: (message: string) => void;
      on: (callback: (message: string) => void) => () => void;
    };
    ptt: {
      onDown: (cb: () => void) => () => void;
      onUp: (cb: () => void) => () => void;
    };
    island: {
      slideTo: (y: number) => void;
    };
    electron: {
      resizePill: (width: number, height: number) => void;
      setClickThrough: (clickThrough: boolean) => void;
      expandPill: (callback: () => void) => void;
      checkPermissions: () => Promise<{ needAX: boolean; needIM: boolean; isDev: boolean }>;
      requestAccessibilityPermission: () => Promise<void>;
      requestInputMonitoringPermission: () => Promise<{ success: boolean; isDev: boolean; alreadyGranted?: boolean; error?: string }>;
      askIM: () => Promise<{ success: boolean; status?: string; isDev: boolean; error?: string }>;
      requestMicrophonePermission: () => Promise<{ success: boolean; granted?: boolean; error?: string }>;
      checkMicrophonePermission: () => Promise<{ status: string; granted: boolean }>;
      openSystemPreferences: (pane: string) => Promise<void>;
      startHelper: () => Promise<void>;
      reloadApp: () => void;
      onboardingComplete: () => Promise<void>;
      getAppPath: () => Promise<string>;
    };
    mic: {
      updateDevices: (
        devices: Array<{ id: string; label: string }>,
        selectedId?: string,
      ) => void;
      select: (id: string) => Promise<{ ok: boolean }>;
      onSelectedChanged: (cb: (payload: { id: string }) => void) => () => void;
      onRefreshRequest: (cb: () => void) => () => void;
    };
  }
}

export {};
