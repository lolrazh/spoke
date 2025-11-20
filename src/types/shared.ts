export type AuthProvider = "google" | "email";

export type AuthCallbackPayload = {
  url: string;
};

export type MicDevice = { id: string; label: string };

export type MicPreferences = { selectedMicId?: string };

export type PillPreferences = { notchWidth?: number };

export type AppPreferences = { showInDock?: boolean };

export type PttTarget = "auto" | "onboarding" | "main";

export type SelectionRange = { location: number; length: number };

export type SelectionInspectSnapshot = {
  ok: boolean;
  status: string;
  range: SelectionRange | null;
  selectedText: string | null;
  context: string | null;
  valueLength: number | null;
  hadSelection: boolean;
  source: "ax" | "clipboard" | "none";
  rawOutput: string;
  error?: string;
};

// Shared IPC payload types
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type EdgeInsets = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

export type DisplayNotchInfo = {
  id: number;
  isBuiltIn: boolean;
  hasNotch: boolean;
  notchWidth: number;
  notchCenterX: number;
  menuBarHeight: number;
  frame: Rect;
  visibleFrame: Rect;
  safeAreaInsets: EdgeInsets;
  auxiliaryLeft: Rect | null;
  auxiliaryRight: Rect | null;
  scaleFactor: number;
  timestamp: number;
};

export type ActiveDisplayPayload = {
  id: number;
  bounds: Rect;
  size: Size;
  workArea: Rect;
  scaleFactor: number;
  scale: number;
  window: Rect | null;
  notch?: DisplayNotchInfo | null;
  storedNotchWidth?: number | null;
};

// Transcription history types
export type TranscriptionItem = {
  id: string;
  text: string;
  timestamp: number; // Unix timestamp in ms
  mode: "dictation" | "edit";
};