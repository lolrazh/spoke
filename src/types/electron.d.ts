/**
 * TypeScript declarations for the Electron API exposed to the renderer process
 */

declare global {
  interface Window {
    electron: {
      toggleDictation: (callback: () => void) => () => void;
      showPillContextMenu: () => void;
      insertTextAtCursor: (text: string) => Promise<{ success: boolean; error?: string }>;
      viewLogFile: () => Promise<string>;
      sendNotification: (message: string) => void;
      transcribeGroq: (
        audioBuffer: ArrayBuffer,
        transferList?: Transferable[],
        upstreamTimings?: Record<string, number>
      ) => Promise<{ transcript: string, timings: Record<string, number> }>;
      transcribeGemini: (
        buf: ArrayBuffer,
        mimeType: string,
        transfer?: Transferable[],
        upstreamTimings?: Record<string, number>
      ) => Promise<{ text: string, timings?: Record<string, number> }>;
      // ALT key push-to-talk events
      onPTTDown: (cb: () => void) => () => void;
      onPTTUp: (cb: () => void) => () => void;
    };
  }
}

export {}; 