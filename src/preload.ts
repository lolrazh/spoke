// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  toggleDictation: (callback: () => void) => {
    // Remove any existing listeners to prevent duplicates
    ipcRenderer.removeAllListeners('toggle-dictation');
    // Add the new listener
    ipcRenderer.on('toggle-dictation', () => callback());
    
    // Return a cleanup function that can be called when the component unmounts
    return () => {
      ipcRenderer.removeAllListeners('toggle-dictation');
    };
  },
  showPillContextMenu: () => {
    ipcRenderer.send('show-context-menu');
  },
  insertTextAtCursor: (text: string) => {
    return ipcRenderer.invoke('insert-text-at-cursor', text);
  },
  // Method to view the log file
  viewLogFile: () => {
    return ipcRenderer.invoke('view-log-file');
  },
  // Add a method for the renderer to request a notification
  sendNotification: (message: string) => {
    ipcRenderer.send('show-notification', message);
  },
  // Method for Groq transcription
  transcribeGroq: (audioBuffer: ArrayBuffer, transferList?: Transferable[]) => {
    if (transferList) {
      return ipcRenderer.invoke('transcribe-groq', audioBuffer, transferList);
    } else {
      return ipcRenderer.invoke('transcribe-groq', audioBuffer);
    }
  },
  transcribeGemini: (buf: ArrayBuffer, transfer?: Transferable[]) =>
    ipcRenderer.invoke('transcribe-gemini', buf, transfer),
});
