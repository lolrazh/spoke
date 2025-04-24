/**
 * TypeScript declarations for the Electron API exposed to the renderer process
 */

interface ElectronAPI {
  toggleDictation: (callback: () => void) => void;
  showContextMenu: () => void;
  insertTextAtCursor: (text: string) => Promise<{ success: boolean; error?: string }>;
  startRecording: () => Promise<{ success: boolean }>;
  stopRecording: () => Promise<{ success: boolean }>;
  transcribeAudio: (audioBuffer: Buffer) => Promise<{ success: boolean; text?: string; error?: string }>;
  logProgress: (progressData: any) => void;
}

interface Window {
  electron: ElectronAPI;
} 