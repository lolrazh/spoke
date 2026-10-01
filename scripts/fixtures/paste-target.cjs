const { app, BrowserWindow, ipcMain, clipboard } = require("electron");
const readline = require("node:readline");
app.setPath("userData", process.env.SPOKE_PASTE_BENCH_PROFILE);
app.setName("Spoke paste benchmark");
function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
let win;
ipcMain.on("bench-change", (_e, value) =>
  out({ type: "changed", ns: Number(process.hrtime.bigint()), text: value }),
);
app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  win = new BrowserWindow({
    width: 620,
    height: 320,
    title: "Spoke paste benchmark — synthetic text only",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  await win.loadURL(
    "data:text/html," +
      encodeURIComponent(
        `<textarea id="field" style="width:95%;height:200px" autofocus></textarea><script>const {ipcRenderer}=require('electron');const field=document.getElementById('field');field.addEventListener('input',()=>ipcRenderer.send('bench-change',field.value));field.focus();</script>`,
      ),
  );
  win.show();
  app.focus({ steal: true });
  win.focus();
  out({ type: "ready", pid: process.pid, ns: Number(process.hrtime.bigint()) });
  readline
    .createInterface({ input: process.stdin })
    .on("line", async (line) => {
      const command = JSON.parse(line);
      if (command.action === "quit") {
        app.quit();
        return;
      }
      if (command.action === "reset") {
        await win.webContents.executeJavaScript(
          `field.value=${JSON.stringify(command.text || "")};field.focus();field.setSelectionRange(${JSON.stringify(command.start ?? (command.text || "").length)},${JSON.stringify(command.end ?? (command.text || "").length)});`,
        );
        out({ type: "reset", ns: Number(process.hrtime.bigint()) });
      }
      if (command.action === "undo") {
        const value = await win.webContents.executeJavaScript(
          `document.execCommand('undo');field.value`,
        );
        out({ type: "undo", text: value, ns: Number(process.hrtime.bigint()) });
      }
      if (command.action === "read-clipboard")
        out({ type: "clipboard", text: clipboard.readText() });
      if (command.action === "read")
        out({
          type: "read",
          text: await win.webContents.executeJavaScript("field.value"),
          ns: Number(process.hrtime.bigint()),
        });
    });
});
