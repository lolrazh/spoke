/**
 * TypeScript declarations for the Electron API exposed to the renderer process
 */

declare global {
  interface Window {
    electron: {
      toggleDictation: (callback: () => void) => () => void;
      showPillContextMenu: () => void;
      insertTextAtCursor: (text: string) => Promise<{ success: boolean; error?: string }>;
      viewLogFile: () => Promise<void>;
      sendNotification: (message: string) => void;
      transcribeGroq: (audioBuffer: ArrayBuffer, transferList?: Transferable[]) => Promise<string>;
      transcribeGemini: (
        buf: ArrayBuffer,
        transfer?: Transferable[]
      ) => Promise<{ text: string }>;
    };
    contextMenuAPI?: {
      send: (channel: 'menu-home' | 'menu-hotkey' | 'menu-exit') => void;
    };
  }
}

export {}; 