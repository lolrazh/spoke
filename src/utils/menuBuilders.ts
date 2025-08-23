import { app, clipboard, MenuItemConstructorOptions, shell } from "electron";
import type { MicDevice } from "../types/shared";

export function buildMicrophoneSubmenu(
  devices: MicDevice[],
  selectedId: string,
  onSelect: (id: string) => void,
): MenuItemConstructorOptions[] {
  const submenu: MenuItemConstructorOptions[] = [];
  if (!devices || devices.length === 0) {
    submenu.push({ label: "No microphones detected", enabled: false });
    return submenu;
  }
  devices.forEach((device) => {
    submenu.push({
      label: device.label,
      type: "radio",
      checked: device.id === selectedId,
      click: () => onSelect(device.id),
    });
  });
  return submenu;
}

export function buildCommonAppItems(
  openSettings: () => void,
): MenuItemConstructorOptions[] {
  return [
    {
      label: "Open Settings",
      click: openSettings,
    },
  ];
}

export function buildFeedbackAndAboutItems(): MenuItemConstructorOptions[] {
  return [
    {
      label: "Send Feedback…",
      click: () => {
        const feedbackEmail = encodeURI(
          `mailto:rajkumar.sandheep@gmail.com?subject=Sonic%20Flow%20Feedback&body=Hi%20there!%0A%0ADescribe%20your%20feedback%20or%20issue%20here...%0A%0A---%0ASonic%20Flow%20${app.getVersion()}%0AmacOS%20${process.getSystemVersion()}`,
        );
        shell.openExternal(feedbackEmail);
      },
    },
    {
      label: "About Sonic Flow",
      click: () => {
        app.setAboutPanelOptions({
          applicationName: "Sonic Flow",
          applicationVersion: app.getVersion(),
          credits: "A lightweight AI dictation tool for macOS.",
          authors: ["Sandheep Rajkumar"],
        });
        app.showAboutPanel();
      },
    },
  ];
}

export function buildCopyTranscriptItem(
  getText: () => string,
  onCopied?: (text: string) => void,
): MenuItemConstructorOptions {
  const text = getText();
  return {
    label: "Copy Last Transcript",
    enabled: text.length > 0,
    click: () => {
      const t = getText();
      if (t) {
        clipboard.writeText(t);
        if (onCopied) onCopied(t);
      }
    },
  };
}
