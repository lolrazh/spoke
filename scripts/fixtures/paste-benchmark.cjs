/* Static, owned Electron textarea. Real native helper, clipboard, formatter and IPC. */
const { app, BrowserWindow, ipcMain, clipboard } = require("electron");
const { performance } = require("node:perf_hooks");
let win;
const processes = new Set();
const childProcess = require("node:child_process");
const spawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  if (win && !win.isFocused()) throw new Error("Scratch window lost focus.");
  const child = spawn(...args);
  processes.add(child);
  child.once("exit", () => processes.delete(child));
  return child;
};
const api = require(process.env.SPOKE_PASTE_BUNDLE);
app.setPath("userData", process.env.SPOKE_PASTE_PROFILE);
app.setName("Spoke paste benchmark");
const stages = [];
const clipboardReads = [];
const info = console.info;
console.info = (...args) => {
  if (args[0] === "[Latency] Text insertion") stages.push(args[1]);
  else if (args[0] === "[Paste] Clipboard read") clipboardReads.push(args[1].observed);
  else info(...args);
};
function setClipboard() {
  clipboard.write({
    text: "SpokeBenchmark original",
    html: "<b>SpokeBenchmark original</b>",
  });
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
ipcMain.handle("bench-insert", async (_event, text) => {
  // The native helper also checks focus. Refuse baseline dispatch if this
  // owned scratch window loses focus: never send keys to a user's document.
  if (!win.isFocused())
    throw new Error("Scratch window lost focus. Run while idle.");
  const start = performance.now();
  const result = await api.insertTextAtCursor(text);
  if (!result.success) throw new Error(result.error);
  return performance.now() - start;
});
ipcMain.handle("bench-prepare", async () => {
  const start = performance.now();
  api.preSpawnPasteHelper();
  if (api.inspectViaPasteDaemon) await api.inspectViaPasteDaemon(96);
  else await pause(150); // Old protocol has no public readiness promise.
  setClipboard();
  return performance.now() - start;
});
ipcMain.handle("bench-clipboard-check", async () => {
  await pause(650);
  const preserved =
    clipboard.readText() === "SpokeBenchmark original" &&
    clipboard.readHTML().includes("<b>SpokeBenchmark original</b>");
  // Same string copied again is still a new clipboard owner.
  if (api.copyViaPasteDaemon) {
    if (!preserved)
      throw new Error("Native clipboard formats were not restored.");
    const restore = await api.copyViaPasteDaemon("SpokeBenchmark newer");
    clipboard.write({
      text: "SpokeBenchmark newer",
      html: "<b>external owner</b>",
    });
    await restore();
    if (!clipboard.readHTML().includes("<b>external owner</b>"))
      throw new Error("Restore overwrote a newer clipboard copy.");
  }
  return preserved;
});
ipcMain.handle("bench-focus-guards", async () => {
  if (!api.inspectViaPasteDaemon) return null;
  await win.webContents.executeJavaScript(
    "field.value='SpokeBenchmark guard text';field.focus();field.setSelectionRange(field.value.length,field.value.length);",
  );
  await pause(100);
  for (const fieldChanged of [false, true]) {
    await api.inspectViaPasteDaemon(96);
    await win.webContents.executeJavaScript(
      fieldChanged
        ? `const other=document.createElement('textarea');document.body.appendChild(other);other.focus();`
        : `field.setSelectionRange(1,1);`,
    );
    await pause(100);
    let rejected = false;
    try {
      await api.pasteViaDaemon(process.pid);
    } catch (error) {
      rejected = /target changed/.test(String(error));
    }
    if (!rejected)
      throw new Error(
        "Focus guard did not reject " +
          (fieldChanged ? "field change" : "caret change"),
      );
    await win.webContents.executeJavaScript("field.focus();");
    await pause(100);
  }
  return true;
});
ipcMain.on("bench-result", (_event, result) => {
  process.stdout.write(
    "BENCH_RESULT:" +
      JSON.stringify({
        ...result,
        stages,
        clipboardReads,
        runtime: {
          electron: process.versions.electron,
          node: process.versions.node,
          platform: process.platform,
          arch: process.arch,
        },
      }) +
      "\n",
  );
  api.killPasteDaemon();
});
app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  win = new BrowserWindow({
    width: 620,
    height: 320,
    title: "Spoke paste benchmark — synthetic text only",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.on("blur", () => {
    // Also stop the old global-key baseline if this window loses focus.
    for (const child of processes) child.kill("SIGKILL");
  });
  const html = `<textarea id="field" style="width:95%;height:200px"></textarea><script>
  const {ipcRenderer}=require('electron');
  const field=document.getElementById('field');
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const percentile=(values,p)=>values.toSorted((a,b)=>a-b)[Math.ceil(values.length*p)-1];
  const summary=values=>({n:values.length,median_ms:percentile(values,.5),p95_ms:percentile(values,.95),max_ms:Math.max(...values)});
  async function runBenchmark(){
   const samples=[],quality_errors=[];
   try {
    field.focus();await delay(400);
    const preparation_ms=await ipcRenderer.invoke('bench-prepare');
    const cases=[{text:'SpokeBenchmark short.',initial:''},{text:'MCP and Marble — λ 231.',initial:'Sample paragraph. '},{text:'SpokeBenchmark replacement.',initial:'Replace this selection.',select:true},{text:'SpokeBenchmark '+('Sample paragraph. '.repeat(50)),initial:''},{text:'Continue here.',initial:'Sample paragraph ',expected:'Sample paragraph continue here. '}];
    for(let i=0;i<${Number(process.env.SPOKE_PASTE_SAMPLES)};i++) {
     const c=cases[i%cases.length];field.value=c.initial;field.focus();field.setSelectionRange(c.select?0:field.value.length,field.value.length);
     await delay(100); // Let Chromium publish the fixture edit to accessibility before timing.
     let receipt;const changed=new Promise(resolve=>{receipt=()=>resolve({at:performance.now(),text:field.value});field.addEventListener('input',receipt,{once:true});});
     const started=performance.now();
     const main_ms=await ipcRenderer.invoke('bench-insert',c.text);
     const ack_ms=performance.now()-started;
     const change=await Promise.race([changed,delay(2000).then(()=>{throw new Error('Text receipt timeout');})]);
     const expected=c.expected||((c.select?'':c.initial)+c.text+(c.text.endsWith(' ')?'':' '));
     if(change.text!==expected){quality_errors.push({index:i,case:i%cases.length});if(!${process.env.SPOKE_PASTE_BASELINE === "1"})throw new Error('Inserted text mismatch in case '+i%cases.length+': '+JSON.stringify({actual:change.text,expected}));}
     samples.push({case:i%cases.length,main_ms,ack_ms,visible_ms:change.at-started});
    }
    const clipboard_formats_preserved=await ipcRenderer.invoke('bench-clipboard-check');
    const undo_ok=document.execCommand('undo') && field.value===cases[(samples.length-1)%cases.length].initial;
    if(!undo_ok)throw new Error('Paste did not preserve browser undo.');
    const focus_guards=await ipcRenderer.invoke('bench-focus-guards');
    ipcRenderer.send('bench-result',{preparation_ms,clipboard_formats_preserved,focus_guards,undo_ok,quality_errors,samples,summary:{main:summary(samples.map(x=>x.main_ms)),renderer_ack:summary(samples.map(x=>x.ack_ms)),text_receipt:summary(samples.map(x=>x.visible_ms))}});
   }catch(error){ipcRenderer.send('bench-result',{error:String(error),samples});}
  }</script>`;
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  win.show();
  app.focus({ steal: true });
  win.focus();
  try {
    await win.webContents.executeJavaScript("runBenchmark()");
  } finally {
    app.quit();
  }
});
