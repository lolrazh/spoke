const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notificationAPI', {
  // We don't expose a function TO the window, 
  // instead, we listen FOR events FROM the main process.
});

// Listen for the message from the main process
ipcRenderer.on('set-notification-message', (event, message) => {
  console.log(`[Preload Notification] Received 'set-notification-message' with message: "${message}"`);
  const messageElement = document.getElementById('message');
  if (messageElement) {
    console.log(`[Preload Notification] Found #message element. Setting textContent.`);
    messageElement.textContent = message;
  } else {
    console.error('[Preload Notification] Could not find #message element in notification window!');
  }
}); 