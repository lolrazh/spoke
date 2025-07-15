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
      resizePill: (width: number) => void;
    };
  }
}

export {};
