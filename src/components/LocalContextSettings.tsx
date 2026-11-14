import React, { useEffect, useState } from "react";

export default function LocalContextSettings() {
  const [settings, setSettings] = useState<{ screenContext: boolean; learnFromEdits: boolean }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    window.localContext?.getSettings().then(value => { if (live) setSettings(value); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (!settings) return null;
  const update = async (key: "screenContext" | "learnFromEdits", enabled: boolean) => {
    setBusy(true);
    try {
      const next = await window.localContext?.setSettings({ [key]: enabled });
      if (next) { setSettings(next); setMessage(next[key] === enabled ? "" : "Could not save this setting."); }
    } catch { setMessage("Could not save this setting."); }
    finally { setBusy(false); }
  };
  const requestScreen = async () => {
    setBusy(true);
    try {
      const granted = await window.localContext?.requestScreenPermission();
      setMessage(granted ? "Local screen reading is ready." : "Allow Spoke Helper in System Settings → Privacy & Security → Screen & System Audio Recording. Then restart Spoke.");
    } catch { setMessage("Could not request screen access."); }
    finally { setBusy(false); }
  };
  return <div className="p-3 space-y-3 text-xs text-foreground/80 no-drag">
    <label className="flex items-center justify-between gap-3">
      <span>Use names from the active window</span>
      <input type="checkbox" checked={settings.screenContext} disabled={busy} onChange={event => void update("screenContext", event.target.checked)} />
    </label>
    <p className="text-muted-foreground">Reads text when dictation starts. Uses local OCR if needed. Screen names are temporary.</p>
    {settings.screenContext && <button type="button" className="underline no-drag" disabled={busy} onClick={() => void requestScreen()}>Allow local screen reading</button>}
    <label className="flex items-center justify-between gap-3">
      <span>Learn verified name corrections</span>
      <input type="checkbox" checked={settings.learnFromEdits} disabled={busy} onChange={event => void update("learnFromEdits", event.target.checked)} />
    </label>
    <p className="text-muted-foreground">Adds a name after the same correction in two dictations within 10 minutes. Checks the pasted text first. Remove a learned name below to undo and stop learning it.</p>
    {message && <p role="status">{message}</p>}
  </div>;
}
