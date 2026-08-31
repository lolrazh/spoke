import { app, MenuItemConstructorOptions, shell } from "electron";
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
      label: "Settings",
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
          `mailto:sandy@spoke.so?subject=Spoke%20Feedback&body=Hi%20there!%0A%0ADescribe%20your%20feedback%20or%20issue%20here...%0A%0A---%0ASpoke%20${app.getVersion()}%0AmacOS%20${process.getSystemVersion()}`,
        );
        shell.openExternal(feedbackEmail);
      },
    },
    {
      label: "About Spoke",
      click: () => {
        app.setAboutPanelOptions({
          applicationName: "Spoke",
          applicationVersion: app.getVersion(),
          credits: "Voice-to-text AI that works everywhere you do.",
          authors: ["Sandheep Rajkumar"],
        });
        app.showAboutPanel();
      },
    },
  ];
}

export function buildPasteTranscriptItem(
  getText: () => string,
  onPaste?: () => void,
): MenuItemConstructorOptions {
  const text = getText();
  return {
    label: "Paste Last Transcript",
    enabled: text.length > 0,
    accelerator: "CommandOrControl+Control+V",
    click: () => {
      if (onPaste) onPaste();
    },
  };
}
