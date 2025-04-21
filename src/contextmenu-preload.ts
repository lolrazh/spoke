import { contextBridge, ipcRenderer } from 'electron';

// Define the channels that the context menu is allowed to send messages on
const validChannels = ['menu-home', /* 'menu-hide', */ 'menu-hotkey', 'menu-exit'] as const;
type ValidChannel = typeof validChannels[number];

// Expose a safe API to the context menu's renderer process
contextBridge.exposeInMainWorld('contextMenuAPI', {
  /**
   * Sends a message to the main process over a specified channel.
   * Only allows sending on pre-approved channels.
   * @param channel The IPC channel to send the message on.
   */
  send: (channel: ValidChannel) => {
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel);
      console.log(`[Preload] Sent IPC message on channel: ${channel}`); // Log from preload
    } else {
      console.warn(`[Preload] Ignoring IPC message on invalid channel: ${channel}`);
    }
  },
});

// Add a type definition for the exposed API
declare global {
  interface Window {
    contextMenuAPI: {
      send: (channel: ValidChannel) => void;
    };
  }
} 