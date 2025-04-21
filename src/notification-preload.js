const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notificationAPI', {
  // We don't expose a function TO the window, 
  // instead, we listen FOR events FROM the main process.
});

// Listen for the message from the main process
ipcRenderer.on('set-notification-message', (event, message) => {
  const messageElement = document.getElementById('message');
  if (messageElement) {
    messageElement.textContent = message;
  }
}); 