// Global type declarations
interface Window {
  electron: {
    toggleDictation: (callback: () => void) => (() => void);
    showPillContextMenu: () => void;
    insertTextAtCursor: (text: string) => Promise<{ success: boolean; error?: string }>;
    viewLogFile: () => Promise<void>;
    startRecording: () => Promise<{ success: boolean; error?: string }>;
    stopRecording: () => Promise<{ success: boolean; error?: string }>;
    transcribeAudio: (audioData: Uint8Array) => Promise<{ success: boolean; text?: string; error?: string }>;
    sendNotification: (message: string) => void;
  };
  contextMenuAPI?: {
    send: (channel: 'menu-account' | 'menu-hotkey' | 'menu-exit') => void;
  };
}