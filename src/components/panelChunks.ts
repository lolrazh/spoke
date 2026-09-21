import { preloadableLazy } from "../utils/preloadableLazy";

/**
 * Code-split panel surfaces, defined in one place so the idle prefetch can
 * pull them in before the user opens the panel. Each is a normal lazy
 * component until preloaded, then renders synchronously.
 */
export const SettingsPanelChunk = preloadableLazy(() => {
  window.electron?.bootMark?.("settings-panel:import:start");
  return import("./SettingsPanel").then((module) => {
    window.electron?.bootMark?.("settings-panel:import:done");
    return module;
  });
});

export const PermissionsPanelChunk = preloadableLazy(() => {
  window.electron?.bootMark?.("permissions-panel:import:start");
  return import("./PermissionsPanel").then((module) => {
    window.electron?.bootMark?.("permissions-panel:import:done");
    return module;
  });
});

export const SfIconChunk = preloadableLazy(() => import("./icons/SfIcon"));
export const ModelsListChunk = preloadableLazy(() => import("./ModelsList"));
export const DictionaryViewChunk = preloadableLazy(
  () => import("./DictionaryView"),
);
export const TranscriptionHistoryViewChunk = preloadableLazy(
  () => import("./TranscriptionHistoryView"),
);
